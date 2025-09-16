use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(relayer_pubkey: Pubkey)]
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

pub fn initialize(ctx: Context<Initialize>, relayer_pubkey: Pubkey) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;

    fifo_state.current_sequence = 0;
    fifo_state.admin = ctx.accounts.admin.key();
    fifo_state.relayer_pubkey = relayer_pubkey;
    fifo_state.emergency_pause = false;

    msg!("Continuum FIFO initialized with admin: {}, relayer: {}",
        ctx.accounts.admin.key(),
        relayer_pubkey
    );

    Ok(())
}