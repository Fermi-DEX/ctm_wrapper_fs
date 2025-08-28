use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use crate::errors::ContinuumError;
use crate::state::*;

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,

    /// CHECK: CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    // Remaining accounts passed through to CP-Swap
}

pub fn deposit_liquidity<'info>(
    ctx: Context<'_, '_, '_, 'info, DepositLiquidity<'info>>,
    min_lp_amount: u64,
    max_token_0_amount: u64,
    max_token_1_amount: u64,
    pool_id: Pubkey,
    pool_authority_bump: u8,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;

    msg!("Deposit liquidity {} on pool {}", sequence, pool_id);

    // Build CP-Swap deposit instruction data
    let mut ix_data = Vec::new();
    // discriminator for cp-swap deposit
    ix_data.extend_from_slice(&[242, 35, 198, 137, 82, 225, 242, 182]);
    ix_data.extend_from_slice(&min_lp_amount.to_le_bytes());
    ix_data.extend_from_slice(&max_token_0_amount.to_le_bytes());
    ix_data.extend_from_slice(&max_token_1_amount.to_le_bytes());

    // Build account metas from remaining accounts
    let mut account_metas = vec![];
    for (i, account) in ctx.remaining_accounts.iter().enumerate() {
        if i == 0 {
            account_metas.push(AccountMeta::new_readonly(account.key(), true));
        } else {
            account_metas.push(if account.is_writable {
                AccountMeta::new(account.key(), false)
            } else {
                AccountMeta::new_readonly(account.key(), false)
            });
        }
    }

    // Create instruction
    let ix = Instruction {
        program_id: ctx.accounts.cp_swap_program.key(),
        accounts: account_metas,
        data: ix_data,
    };

    // Pool authority signer seeds
    let pool_authority_seeds = &[
        b"cp_pool_authority",
        pool_id.as_ref(),
        &[pool_authority_bump],
    ];

    // Build CPI account array including cp_swap_program
    let cpi_accounts: Vec<AccountInfo<'info>> =
        std::iter::once(ctx.accounts.cp_swap_program.to_account_info())
            .chain(ctx.remaining_accounts.iter().cloned())
            .collect();

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

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,

    /// CHECK: CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    // Remaining accounts passed through to CP-Swap
}

pub fn withdraw_liquidity<'info>(
    ctx: Context<'_, '_, '_, 'info, WithdrawLiquidity<'info>>,
    lp_amount: u64,
    min_token_0_amount: u64,
    min_token_1_amount: u64,
    pool_id: Pubkey,
    pool_authority_bump: u8,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;

    msg!("Withdraw liquidity {} on pool {}", sequence, pool_id);

    let mut ix_data = Vec::new();
    // discriminator for cp-swap withdraw
    ix_data.extend_from_slice(&[183, 18, 70, 156, 148, 109, 161, 34]);
    ix_data.extend_from_slice(&lp_amount.to_le_bytes());
    ix_data.extend_from_slice(&min_token_0_amount.to_le_bytes());
    ix_data.extend_from_slice(&min_token_1_amount.to_le_bytes());

    let mut account_metas = vec![];
    for (i, account) in ctx.remaining_accounts.iter().enumerate() {
        if i == 0 {
            account_metas.push(AccountMeta::new_readonly(account.key(), true));
        } else {
            account_metas.push(if account.is_writable {
                AccountMeta::new(account.key(), false)
            } else {
                AccountMeta::new_readonly(account.key(), false)
            });
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

    let cpi_accounts: Vec<AccountInfo<'info>> =
        std::iter::once(ctx.accounts.cp_swap_program.to_account_info())
            .chain(ctx.remaining_accounts.iter().cloned())
            .collect();

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
