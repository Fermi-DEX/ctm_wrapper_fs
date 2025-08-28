use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = FifoState::LEN,
        seeds = [b"fifo_state"],
        bump
    )]
    pub fifo_state: Account<'info, FifoState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;

    fifo_state.current_sequence = 0;
    fifo_state.admin = ctx.accounts.admin.key();
    fifo_state.emergency_pause = false;

    msg!(
        "Continuum FIFO initialized with admin: {}",
        ctx.accounts.admin.key()
    );

    Ok(())
}
