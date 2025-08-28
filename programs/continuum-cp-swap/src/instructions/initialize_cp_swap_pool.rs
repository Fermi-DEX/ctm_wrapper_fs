use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

#[derive(Accounts)]
pub struct InitializeCpSwapPool<'info> {
    #[account(
        seeds = [b"fifo_state"],
        bump,
        has_one = admin,
    )]
    pub fifo_state: Account<'info, FifoState>,

    #[account(
        init,
        payer = admin,
        space = CpSwapPoolRegistry::LEN,
        seeds = [b"pool_registry", pool_state.key().as_ref()],
        bump
    )]
    pub pool_registry: Account<'info, CpSwapPoolRegistry>,

    /// The pool authority PDA that will be set as custom authority
    /// Seeds: ["cp_pool_authority", pool_state]
    /// CHECK: This is a PDA that will be set as the custom authority for the pool
    #[account(
        seeds = [b"cp_pool_authority", pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: The pool state account that will be created by CP-Swap
    pub pool_state: UncheckedAccount<'info>,

    /// CHECK: The CP-Swap program
    pub cp_swap_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // Remaining accounts are passed through to CP-Swap initialize instruction
}

pub fn initialize_cp_swap_pool(
    ctx: Context<InitializeCpSwapPool>,
    init_amount_0: u64,
    init_amount_1: u64,
    open_time: u64,
) -> Result<()> {
    let pool_state_key = ctx.accounts.pool_state.key();
    let pool_authority_bump = ctx.bumps.pool_authority;

    // Build the CPI instruction data for CP-Swap initialize
    // This matches the CP-Swap initialize instruction signature:
    // initialize(init_amount_0, init_amount_1, open_time, authority_type, custom_authority)
    let mut ix_data = Vec::new();

    // Add the instruction discriminator (this is specific to CP-Swap)
    // You'll need to check the actual discriminator from the CP-Swap IDL
    ix_data.extend_from_slice(&[175, 175, 109, 31, 13, 152, 155, 237]); // initialize discriminator

    // Add parameters
    ix_data.extend_from_slice(&init_amount_0.to_le_bytes());
    ix_data.extend_from_slice(&init_amount_1.to_le_bytes());
    ix_data.extend_from_slice(&open_time.to_le_bytes());
    ix_data.push(1); // authority_type = 1 (custom)
    ix_data.push(1); // Option<Pubkey> is Some
    ix_data.extend_from_slice(&ctx.accounts.pool_authority.key().to_bytes());

    // Build account metas for CPI
    let mut account_metas = vec![];

    // Add all remaining accounts in the order expected by CP-Swap
    for account in ctx.remaining_accounts.iter() {
        account_metas.push(if account.is_writable {
            if account.is_signer {
                AccountMeta::new(account.key(), true)
            } else {
                AccountMeta::new(account.key(), false)
            }
        } else {
            if account.is_signer {
                AccountMeta::new_readonly(account.key(), true)
            } else {
                AccountMeta::new_readonly(account.key(), false)
            }
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
        pool_state_key.as_ref(),
        &[pool_authority_bump],
    ];

    invoke_signed(&ix, ctx.remaining_accounts, &[pool_authority_seeds])?;

    // Register the pool
    let registry = &mut ctx.accounts.pool_registry;
    registry.pool_id = pool_state_key;
    registry.continuum_authority = ctx.accounts.pool_authority.key();
    registry.created_at = Clock::get()?.unix_timestamp;
    registry.is_active = true;

    // TODO: Extract token mints from remaining accounts
    // For now, we'll need to pass them as additional parameters or extract from pool state
    registry.token_0 = Pubkey::default(); // To be filled
    registry.token_1 = Pubkey::default(); // To be filled

    emit!(PoolRegistered {
        pool_id: pool_state_key,
        continuum_authority: ctx.accounts.pool_authority.key(),
    });

    msg!("CP-Swap pool initialized with Continuum authority");

    Ok(())
}
