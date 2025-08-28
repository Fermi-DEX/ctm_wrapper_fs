use crate::errors::ContinuumError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

#[derive(Accounts)]
pub struct WithdrawLp<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,

    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    // All other accounts are passed through in remaining_accounts
}

pub fn withdraw_lp<'info>(
    ctx: Context<'_, '_, '_, 'info, WithdrawLp<'info>>,
    lp_amount: u64,
    min_amount_0: u64,
    min_amount_1: u64,
    pool_id: Pubkey,
    pool_authority_bump: u8,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;

    msg!("Withdraw liquidity {} from pool {}", sequence, pool_id);

    let mut ix_data = Vec::new();
    // CP-Swap withdraw discriminator
    ix_data.extend_from_slice(&[183, 18, 70, 156, 148, 109, 161, 34]);
    ix_data.extend_from_slice(&lp_amount.to_le_bytes());
    ix_data.extend_from_slice(&min_amount_0.to_le_bytes());
    ix_data.extend_from_slice(&min_amount_1.to_le_bytes());

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

    let cp_swap_program = ctx.accounts.cp_swap_program.to_account_info();
    let remaining_accounts: Vec<AccountInfo<'_>> =
        ctx.remaining_accounts.iter().map(|a| a.to_account_info()).collect();
    let mut cpi_accounts: Vec<AccountInfo<'_>> = Vec::with_capacity(remaining_accounts.len() + 1);
    cpi_accounts.push(cp_swap_program);
    cpi_accounts.extend(remaining_accounts);

    invoke_signed(&ix, &cpi_accounts, &[pool_authority_seeds])?;

    emit!(LiquidityWithdrawn {
        sequence,
        pool_id,
        lp_amount,
    });

    Ok(())
}

#[event]
pub struct LiquidityWithdrawn {
    pub sequence: u64,
    pub pool_id: Pubkey,
    pub lp_amount: u64,
}
