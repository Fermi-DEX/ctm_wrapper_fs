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

    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    // All other accounts (user, pool_authority, pool_id, user accounts, etc.)
    // are passed through in remaining_accounts to avoid deserialization
}

pub fn swap_immediate<'info>(
    ctx: Context<'_, '_, '_, 'info, SwapImmediate<'info>>,
    amount_in: u64,
    min_amount_out: u64,
    is_base_input: bool,
    pool_id: Pubkey,
    pool_authority_bump: u8,
) -> Result<()> {
    let fifo_state = &mut ctx.accounts.fifo_state;

    // Increment sequence for tracking
    let sequence = fifo_state.current_sequence + 1;
    fifo_state.current_sequence = sequence;

    msg!("Immediate swap {} on pool {}", sequence, pool_id);

    // Build the swap instruction data
    let mut ix_data = Vec::new();

    // IMPORTANT: We now use swap_base_input for both directions to maintain consistent semantics
    // This gives us "I have exactly X tokens, give me at least Y tokens" behavior regardless of direction

    // Always use swap_base_input discriminator
    ix_data.extend_from_slice(&[143, 190, 90, 218, 196, 30, 51, 222]);
    ix_data.extend_from_slice(&amount_in.to_le_bytes()); // exact tokens to swap
    ix_data.extend_from_slice(&min_amount_out.to_le_bytes()); // minimum tokens to receive

    // Build account metas from remaining accounts
    // The client must pass accounts in the correct order for CP-Swap
    let mut account_metas = vec![];

    // Add all remaining accounts as they were passed
    for (i, account) in ctx.remaining_accounts.iter().enumerate() {
        // First account should be the user (payer for CP-Swap)
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

    // Build accounts array for CPI, including the cp_swap_program
    let cp_swap_program = ctx.accounts.cp_swap_program.to_account_info();
    let remaining_accounts: Vec<AccountInfo<'_>> =
        ctx.remaining_accounts.iter().map(|a| a.to_account_info()).collect();
    let mut cpi_accounts: Vec<AccountInfo<'_>> = Vec::with_capacity(remaining_accounts.len() + 1);
    cpi_accounts.push(cp_swap_program);
    cpi_accounts.extend(remaining_accounts);

    // Pass all accounts to invoke_signed
    invoke_signed(&ix, &cpi_accounts, &[pool_authority_seeds])?;

    emit!(SwapExecuted {
        sequence,
        pool_id,
        amount_in,
        is_base_input, // Note: This parameter is now only used for logging, not for routing
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
