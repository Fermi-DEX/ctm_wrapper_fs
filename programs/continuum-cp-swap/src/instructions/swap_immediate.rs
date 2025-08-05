use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    instruction::{Instruction, AccountMeta},
};
use crate::state::*;
use crate::errors::ContinuumError;

#[derive(Accounts)]
pub struct SwapImmediate<'info> {
    #[account(
        mut,
        seeds = [b"fifo_state"],
        bump,
        //constraint = !fifo_state.emergency_pause @ ContinuumError::EmergencyPause,
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    /// The relayer executing the swap - must be authorized
    /*#[account(
        constraint = fifo_state.authorized_relayers.contains(&relayer.key()) @ ContinuumError::UnauthorizedRelayer
    )]
    pub relayer: Signer<'info>,
    */

    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    
    // All other accounts (user, pool_authority, pool_id, user accounts, etc.) 
    // are passed through in remaining_accounts to avoid deserialization
}

pub fn swap_immediate(
    ctx: Context<SwapImmediate>,
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
    
    if is_base_input {
        // swap_base_input discriminator
        ix_data.extend_from_slice(&[143, 190, 90, 218, 196, 30, 51, 222]); 
        ix_data.extend_from_slice(&amount_in.to_le_bytes());
        ix_data.extend_from_slice(&min_amount_out.to_le_bytes());
    } else {
        // swap_base_output discriminator
        ix_data.extend_from_slice(&[143, 190, 90, 218, 196, 30, 51, 222]); 
        ix_data.extend_from_slice(&amount_in.to_le_bytes());
        ix_data.extend_from_slice(&min_amount_out.to_le_bytes());
        //ix_data.extend_from_slice(&[55, 217, 98, 86, 163, 74, 180, 173]);
        //ix_data.extend_from_slice(&min_amount_out.to_le_bytes()); // max_amount_in
        //ix_data.extend_from_slice(&amount_in.to_le_bytes()); // amount_out
    }
    
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
    
    // Pass all remaining accounts directly to invoke_signed
    // The client must ensure the correct ordering
    invoke_signed(
        &ix,
        ctx.remaining_accounts,
        &[pool_authority_seeds],
    )?;
    
    // Extract user from first remaining account
    let user = ctx.remaining_accounts.get(0)
        .ok_or(ContinuumError::Unauthorized)?
        .key();
    
    emit!(SwapExecuted {
        sequence,
        pool_id,
        amount_in,
        user,
        //relayer: ctx.accounts.relayer.key(),
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
    pub user: Pubkey,
    //pub relayer: Pubkey,
    pub is_base_input: bool,
}