use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(
        mut,
        seeds = [b"order", user.key().as_ref(), &order_state.sequence.to_le_bytes()],
        bump,
        constraint = order_state.status == OrderStatus::Pending @ ContinuumError::InvalidOrderStatus,
        constraint = order_state.user == user.key() @ ContinuumError::Unauthorized,
    )]
    pub order_state: Account<'info, OrderState>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub clock: Sysvar<'info, Clock>,
}

pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
    let order_state = &mut ctx.accounts.order_state;

    order_state.status = OrderStatus::Cancelled;
    order_state.executed_at = Some(ctx.accounts.clock.unix_timestamp);

    emit!(OrderCancelled {
        sequence: order_state.sequence,
        user: ctx.accounts.user.key(),
    });

    msg!("Order {} cancelled by user", order_state.sequence);

    Ok(())
}
