use crate::errors::ContinuumError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

#[derive(Accounts)]
pub struct DepositLp<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,

    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    // All other accounts (user, pool_state, token accounts, etc.)
    // are passed through in remaining_accounts
}

pub fn deposit_lp<'info>(
    ctx: Context<'_, '_, '_, 'info, DepositLp<'info>>,
    min_lp_amount: u64,
    max_amount_0: u64,
    max_amount_1: u64,
    pool_id: Pubkey,
    pool_authority_bump: u8,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;

    msg!("Deposit liquidity {} on pool {}", sequence, pool_id);

    let mut ix_data = Vec::new();
    // CP-Swap deposit discriminator
    ix_data.extend_from_slice(&[242, 35, 198, 137, 82, 225, 242, 182]);
    ix_data.extend_from_slice(&min_lp_amount.to_le_bytes());
    ix_data.extend_from_slice(&max_amount_0.to_le_bytes());
    ix_data.extend_from_slice(&max_amount_1.to_le_bytes());

    let mut account_metas = vec![];
    for (i, account) in ctx.remaining_accounts.iter().enumerate() {
        if i == 0 {
            account_metas.push(AccountMeta::new_readonly(account.key(), true));
        } else if account.is_writable {
            account_metas.push(AccountMeta::new(account.key(), false));
        } else {
            account_metas.push(AccountMeta::new_readonly(account.key(), false));
        }
    }

    let ix = Instruction {
        program_id: ctx.accounts.cp_swap_program.key(),
        accounts: account_metas,
        data: ix_data,
    };

    let pool_authority_seeds = &[
        b"cp_pool_authority",
        pool_id.as_ref(),
        &[pool_authority_bump],
    ];

    let mut cpi_accounts = ctx.remaining_accounts.to_vec();
    cpi_accounts.insert(0, ctx.accounts.cp_swap_program.to_account_info());

    invoke_signed(&ix, &cpi_accounts, &[pool_authority_seeds])?;

    emit!(LiquidityDeposited {
        sequence,
        pool_id,
        min_lp_amount,
    });

    Ok(())
}

#[event]
pub struct LiquidityDeposited {
    pub sequence: u64,
    pub pool_id: Pubkey,
    pub min_lp_amount: u64,
}
