use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::token::{Token, TokenAccount};

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
        constraint = order_state.sequence == expected_sequence @ ContinuumError::InvalidSequence,
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
    // Remaining accounts are passed through to CP-Swap swap instruction
}

pub fn execute_order(ctx: Context<ExecuteOrder>, expected_sequence: u64) -> Result<()> {
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
    account_metas.push(AccountMeta::new_readonly(
        ctx.accounts.pool_authority.key(),
        true,
    ));

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
