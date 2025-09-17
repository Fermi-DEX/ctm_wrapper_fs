use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct RegisterPool<'info> {
    #[account(
        seeds = [b"fifo_state"],
        bump,
        has_one = admin,
    )]
    pub fifo_state: Account<'info, FifoState>,

    #[account(
        init,
        payer = admin,
        space = CpSwapPoolRegistry::LEN,
        seeds = [b"pool_registry", pool_state.key().as_ref()],
        bump
    )]
    pub pool_registry: Account<'info, CpSwapPoolRegistry>,

    /// The pool authority PDA that should be the custom authority
    /// Seeds: ["cp_pool_authority", pool_state]
    /// CHECK: This is a PDA that should be set as the custom authority for the pool
    #[account(
        seeds = [b"cp_pool_authority", pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: The pool state account that should already exist
    pub pool_state: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_pool(
    ctx: Context<RegisterPool>,
    token_0: Pubkey,
    token_1: Pubkey,
) -> Result<()> {
    let pool_state_key = ctx.accounts.pool_state.key();

    // Register the pool
    let registry = &mut ctx.accounts.pool_registry;
    registry.pool_id = pool_state_key;
    registry.token_0 = token_0;
    registry.token_1 = token_1;
    registry.continuum_authority = ctx.accounts.pool_authority.key();
    registry.created_at = Clock::get()?.unix_timestamp;
    registry.is_active = true;

    emit!(PoolRegistered {
        pool_id: pool_state_key,
        continuum_authority: ctx.accounts.pool_authority.key(),
    });

    msg!("Pool registered with Continuum authority");

    Ok(())
}