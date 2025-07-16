use anchor_lang::prelude::*;

declare_id!("A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn");

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

#[program]
pub mod continuum_cp_swap {
    use super::*;

    /// Initialize the global FIFO state
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    /// Initialize a CP-Swap pool with Continuum as custom authority
    pub fn initialize_cp_swap_pool(
        ctx: Context<InitializeCpSwapPool>,
        init_amount_0: u64,
        init_amount_1: u64,
        open_time: u64,
    ) -> Result<()> {
        instructions::initialize_cp_swap_pool(ctx, init_amount_0, init_amount_1, open_time)
    }

    /// Submit a swap order to the FIFO queue
    pub fn submit_order(
        ctx: Context<SubmitOrder>,
        amount_in: u64,
        min_amount_out: u64,
        is_base_input: bool,
    ) -> Result<()> {
        instructions::submit_order(ctx, amount_in, min_amount_out, is_base_input)
    }

    /// Execute the next order in the FIFO queue
    pub fn execute_order(
        ctx: Context<ExecuteOrder>,
        expected_sequence: u64,
    ) -> Result<()> {
        instructions::execute_order(ctx, expected_sequence)
    }

    /// Cancel an order (only by original submitter)
    pub fn cancel_order(
        ctx: Context<CancelOrder>,
    ) -> Result<()> {
        instructions::cancel_order(ctx)
    }
}