use crate::errors::ContinuumError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

#[derive(Accounts)]
pub struct SwapImmediate<'info> {
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

    /// The pool authority PDA that signs for the swap
    /// CHECK: This is a PDA that will be used to sign the CPI
    #[account(
        seeds = [b"cp_pool_authority", pool_id.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: The pool to swap in
    pub pool_id: UncheckedAccount<'info>,

    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    // Remaining accounts are passed through to CP-Swap swap instruction as-is
}

pub fn swap_immediate<'info>(
    ctx: Context<'_, '_, '_, 'info, SwapImmediate<'info>>,
    amount_in: u64,
    min_amount_out: u64,
    is_base_input: bool,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;
    let pool_authority_bump = ctx.bumps.pool_authority;
    let pool_id = ctx.accounts.pool_id.key();

    // Increment sequence for tracking
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;

    msg!("Immediate swap {} on pool {}", sequence, pool_id);

    // Build the swap instruction data
    let mut ix_data = Vec::new();

    if is_base_input {
        // swap_base_input discriminator
        ix_data.extend_from_slice(&[143, 190, 90, 218, 196, 30, 51, 222]);
        ix_data.extend_from_slice(&amount_in.to_le_bytes());
        ix_data.extend_from_slice(&min_amount_out.to_le_bytes());
    } else {
        // swap_base_output discriminator
        ix_data.extend_from_slice(&[55, 217, 98, 86, 163, 74, 180, 173]);
        ix_data.extend_from_slice(&min_amount_out.to_le_bytes()); // max_amount_in
        ix_data.extend_from_slice(&amount_in.to_le_bytes()); // amount_out
    }

    // Build account metas - pool authority is first and is a signer
    let mut account_metas = vec![AccountMeta::new_readonly(
        ctx.accounts.pool_authority.key(),
        true,
    )];

    // Add all remaining accounts as they were passed
    for account in ctx.remaining_accounts.iter() {
        account_metas.push(if account.is_writable {
            AccountMeta::new(account.key(), false)
        } else {
            AccountMeta::new_readonly(account.key(), false)
        });
    }

    // Create the instruction
    let ix = Instruction {
        program_id: ctx.accounts.cp_swap_program.key(),
        accounts: account_metas,
        data: ix_data,
    };

    // Invoke CP-Swap with pool authority signer
    let pool_authority_seeds = &[
        b"cp_pool_authority",
        pool_id.as_ref(),
        &[pool_authority_bump],
    ];

    // For invoke_signed, we pass all accounts including pool authority first
    // Since pool authority is the first account in our instruction, it must be first here too
    let pool_authority_info = ctx.accounts.pool_authority.to_account_info();
    let mut all_accounts = Vec::with_capacity(1 + ctx.remaining_accounts.len());
    all_accounts.push(pool_authority_info);
    all_accounts.extend(ctx.remaining_accounts.iter().cloned());

    invoke_signed(&ix, &all_accounts, &[pool_authority_seeds])?;

    emit!(SwapExecuted {
        sequence,
        pool_id,
        amount_in,
        is_base_input,
    });

    msg!("Swap {} executed successfully", sequence);

    Ok(())
}

#[event]
pub struct SwapExecuted {
    pub sequence: u64,
    pub pool_id: Pubkey,
    pub amount_in: u64,
    pub is_base_input: bool,
}
