use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::invoke_signed,
    instruction::{Instruction, AccountMeta},
    sysvar::instructions::{self, load_current_index_checked, load_instruction_at_checked},
    ed25519_program,
};
use anchor_spl::token::{Token, TokenAccount};
use crate::state::*;
use crate::errors::*;

#[derive(Accounts)]
#[instruction(expected_sequence: u64)]
pub struct ExecuteOrder<'info> {
    #[account(
        seeds = [b"fifo_state"],
        bump,
    )]
    pub fifo_state: Account<'info, FifoState>,
    
    #[account(
        mut,
        seeds = [b"order", order_state.user.as_ref(), &expected_sequence.to_le_bytes()],
        bump,
        constraint = order_state.sequence == expected_sequence + 1 @ ContinuumError::InvalidSequence,
        constraint = order_state.status == OrderStatus::Pending @ ContinuumError::InvalidOrderStatus,
    )]
    pub order_state: Account<'info, OrderState>,
    
    #[account(
        seeds = [b"pool_registry", order_state.pool_id.as_ref()],
        bump,
    )]
    pub pool_registry: Account<'info, CpSwapPoolRegistry>,
    
    /// The pool authority PDA that signs for the swap
    /// CHECK: This is a PDA that will be used to sign the CPI
    #[account(
        seeds = [b"cp_pool_authority", order_state.pool_id.as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,
    
    /// The relayer executing the order
    #[account(mut)]
    pub executor: Signer<'info>,
    
    /// User's source token account (for input tokens)
    #[account(
        mut,
        constraint = user_source.owner == order_state.user,
    )]
    pub user_source: Box<Account<'info, TokenAccount>>,
    
    /// User's destination token account (for output tokens)
    #[account(
        mut,
        constraint = user_destination.owner == order_state.user,
    )]
    pub user_destination: Box<Account<'info, TokenAccount>>,
    
    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,

    /// Instructions sysvar for Ed25519 verification
    /// CHECK: This is the instructions sysvar account
    #[account(address = instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    // Remaining accounts are passed through to CP-Swap swap instruction
}

pub fn execute_order(
    ctx: Context<ExecuteOrder>,
    expected_sequence: u64,
) -> Result<()> {
    // Verify relayer signature using Ed25519 precompile instruction
    verify_relayer_signature(
        &ctx.accounts.instructions_sysvar,
        &ctx.accounts.fifo_state.relayer_pubkey,
        expected_sequence,
        ctx.accounts.executor.key(),
    )?;

    let pool_authority_bump = ctx.bumps.pool_authority;
    let pool_id = ctx.accounts.order_state.pool_id;
    let sequence = ctx.accounts.order_state.sequence;
    let user = ctx.accounts.order_state.user;
    let is_base_input = ctx.accounts.order_state.is_base_input;
    let amount_in = ctx.accounts.order_state.amount_in;
    let min_amount_out = ctx.accounts.order_state.min_amount_out;

    // Log sequence information for debugging
    msg!("Execute order - Expected sequence param: {}, Order sequence: {}, Current FIFO sequence: {}",
        expected_sequence,
        sequence,
        ctx.accounts.fifo_state.current_sequence
    );
    msg!("Order user: {}, Order pool: {}", user, pool_id);
    
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
    
    // Build account metas
    let mut account_metas = vec![];
    
    // Add the pool authority as the first account (signer)
    account_metas.push(AccountMeta::new_readonly(ctx.accounts.pool_authority.key(), true));
    
    // Add user token accounts
    account_metas.push(AccountMeta::new(ctx.accounts.user_source.key(), false));
    account_metas.push(AccountMeta::new(ctx.accounts.user_destination.key(), false));
    
    // Add remaining accounts (pool state, vaults, etc.)
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
    
    // Execute swap with pool authority signer
    let pool_authority_seeds = &[
        b"cp_pool_authority",
        pool_id.as_ref(),
        &[pool_authority_bump],
    ];
    
    // Get the starting balance for calculating amount_out
    let start_balance = ctx.accounts.user_destination.amount;
    
    invoke_signed(
        &ix,
        &[
            ctx.accounts.pool_authority.to_account_info(),
            ctx.accounts.user_source.to_account_info(),
            ctx.accounts.user_destination.to_account_info(),
        ],
        &[pool_authority_seeds],
    )?;
    
    // Update order status
    let order_state = &mut ctx.accounts.order_state;
    order_state.status = OrderStatus::Executed;
    order_state.executed_at = Some(ctx.accounts.clock.unix_timestamp);
    
    // Reload destination account to get final balance
    ctx.accounts.user_destination.reload()?;
    let amount_out = ctx.accounts.user_destination.amount - start_balance;
    
    emit!(OrderExecuted {
        sequence,
        user,
        amount_out,
        executor: ctx.accounts.executor.key(),
    });
    
    msg!("Order {} executed successfully", sequence);

    Ok(())
}

/// Verify that the relayer has signed this execution with Ed25519 precompile
fn verify_relayer_signature(
    instructions_sysvar: &UncheckedAccount,
    expected_relayer_pubkey: &Pubkey,
    sequence: u64,
    executor: Pubkey,
) -> Result<()> {
    // Get the current instruction index
    let current_index = load_current_index_checked(&instructions_sysvar.to_account_info())?;

    // Look for Ed25519 precompile instruction immediately before this instruction
    if current_index == 0 {
        return Err(ContinuumError::MissingEd25519Instruction.into());
    }

    // Load the previous instruction (should be Ed25519 verification)
    let ed25519_instruction = load_instruction_at_checked(
        (current_index - 1) as usize,
        &instructions_sysvar.to_account_info()
    ).map_err(|_| ContinuumError::MissingEd25519Instruction)?;

    // Verify it's an Ed25519 instruction
    if ed25519_instruction.program_id != ed25519_program::ID {
        return Err(ContinuumError::InvalidEd25519Instruction.into());
    }

    // Parse Ed25519 instruction data
    if ed25519_instruction.data.len() < 112 {
        return Err(ContinuumError::InvalidEd25519Data.into());
    }

    // Extract signature (64 bytes), public key (32 bytes), and message
    let signature = &ed25519_instruction.data[16..80]; // Skip signature offset data
    let pubkey_bytes = &ed25519_instruction.data[80..112];

    // Verify the public key matches the expected relayer
    let relayer_pubkey_bytes = expected_relayer_pubkey.to_bytes();
    if pubkey_bytes != relayer_pubkey_bytes {
        return Err(ContinuumError::InvalidRelayerPubkey.into());
    }

    // Create the expected message: sequence + executor
    let mut message = Vec::new();
    message.extend_from_slice(&sequence.to_le_bytes());
    message.extend_from_slice(&executor.to_bytes());

    // Verify the message was signed
    let expected_message = &ed25519_instruction.data[112..];
    if expected_message != message {
        return Err(ContinuumError::InvalidSignatureMessage.into());
    }

    msg!("Relayer signature verified for sequence {} by relayer {}", sequence, expected_relayer_pubkey);

    Ok(())
}