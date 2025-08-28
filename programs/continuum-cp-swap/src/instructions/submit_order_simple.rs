use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

#[derive(Accounts)]
pub struct SubmitOrderSimple<'info> {
    #[account(
        mut,
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

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: The pool ID to validate against registry
    pub pool_id: UncheckedAccount<'info>,

    /// User's source token account
    #[account(
        mut,
        constraint = user_source_token.owner == user.key(),
    )]
    pub user_source_token: Account<'info, TokenAccount>,

    /// User's destination token account  
    #[account(
        mut,
        constraint = user_destination_token.owner == user.key(),
    )]
    pub user_destination_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn submit_order_simple(
    ctx: Context<SubmitOrderSimple>,
    amount_in: u64,
    _min_amount_out: u64,
    is_base_input: bool,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;

    // Just increment sequence and emit event
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;

    msg!(
        "Order {} submitted by user {} for pool {}",
        sequence,
        ctx.accounts.user.key(),
        ctx.accounts.pool_id.key()
    );

    emit!(OrderSubmitted {
        sequence,
        user: ctx.accounts.user.key(),
        pool_id: ctx.accounts.pool_id.key(),
        amount_in,
        is_base_input,
    });

    Ok(())
}
