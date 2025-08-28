use crate::errors::ContinuumError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(
        seeds = [b"fifo_state"],
        bump,
        constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,

    #[account(
        seeds = [b"pool_registry", pool_id.key().as_ref()],
        bump,
        constraint = pool_registry.is_active @ ContinuumError::PoolNotRegistered,
    )]
    pub pool_registry: Account<'info, CpSwapPoolRegistry>,

    /// The pool authority PDA that signs for the CPI
    /// CHECK: PDA used as signer
    #[account(
        seeds = [b"cp_pool_authority", pool_id.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: The target pool id
    pub pool_id: UncheckedAccount<'info>,

    /// CHECK: Raydium CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    // Remaining accounts are passed directly to CP-Swap deposit instruction
}

pub fn deposit_liquidity<'info>(
    ctx: Context<'_, '_, '_, 'info, DepositLiquidity<'info>>,
) -> Result<()> {
    let pool_authority_bump = ctx.bumps.pool_authority;
    let pool_id = ctx.accounts.pool_id.key();

    // Build CPI instruction data - deposit discriminator
    let ix_data = vec![242, 35, 198, 137, 82, 225, 242, 182];

    // Build account metas - pool authority first signer
    let mut account_metas = vec![AccountMeta::new_readonly(
        ctx.accounts.pool_authority.key(),
        true,
    )];

    for account in ctx.remaining_accounts.iter() {
        account_metas.push(if account.is_writable {
            if account.is_signer {
                AccountMeta::new(account.key(), true)
            } else {
                AccountMeta::new(account.key(), false)
            }
        } else {
            if account.is_signer {
                AccountMeta::new_readonly(account.key(), true)
            } else {
                AccountMeta::new_readonly(account.key(), false)
            }
        });
    }

    let ix = Instruction {
        program_id: ctx.accounts.cp_swap_program.key(),
        accounts: account_metas,
        data: ix_data,
    };

    let pool_authority_info = ctx.accounts.pool_authority.to_account_info();
    let mut all_accounts = Vec::with_capacity(1 + ctx.remaining_accounts.len());
    all_accounts.push(pool_authority_info);
    all_accounts.extend(ctx.remaining_accounts.iter().cloned());

    let seeds = &[
        b"cp_pool_authority",
        pool_id.as_ref(),
        &[pool_authority_bump],
    ];

    invoke_signed(&ix, &all_accounts, &[seeds])?;

    Ok(())
}
