use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::errors::ContinuumError;

/// CPI accounts for CP-Swap withdraw
#[derive(Accounts, Clone)]
pub struct CpSwapWithdrawAccounts<'info> {
    /// The user/payer account
    pub owner: AccountInfo<'info>,
    /// Pool state account
    pub pool_state: AccountInfo<'info>,
    /// LP mint account
    pub lp_mint: AccountInfo<'info>,
    /// User token A account
    pub user_token_0: AccountInfo<'info>,
    /// User token B account  
    pub user_token_1: AccountInfo<'info>,
    /// User LP token account
    pub user_lp: AccountInfo<'info>,
    /// Vault A
    pub token_0_vault: AccountInfo<'info>,
    /// Vault B
    pub token_1_vault: AccountInfo<'info>,
    /// Token program
    pub token_program: AccountInfo<'info>,
    /// Token program 2022
    pub token_program_2022: AccountInfo<'info>,
    /// Vault authority
    pub vault_0_mint: AccountInfo<'info>,
    /// Memo program
    pub memo_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    /// The user withdrawing liquidity
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// Pool state account from CP-Swap
    /// CHECK: This account is validated by the CP-Swap program
    #[account(mut)]
    pub pool_state: AccountInfo<'info>,
    
    /// Pool authority PDA (owned by Continuum)
    /// This verifies that the pool is managed by Continuum
    #[account(
        seeds = [b"cp_pool_authority", pool_state.key().as_ref()],
        bump,
    )]
    /// CHECK: This is a PDA that serves as authority
    pub pool_authority: AccountInfo<'info>,
    
    /// LP mint
    /// CHECK: Validated by CP-Swap
    #[account(mut)]
    pub lp_mint: AccountInfo<'info>,
    
    /// User's token A account
    #[account(
        mut,
        token::mint = token_0_mint,
        token::authority = user
    )]
    pub user_token_0: Account<'info, TokenAccount>,
    
    /// User's token B account
    #[account(
        mut,
        token::mint = token_1_mint,
        token::authority = user
    )]
    pub user_token_1: Account<'info, TokenAccount>,
    
    /// User's LP token account
    #[account(
        mut,
        token::mint = lp_mint,
        token::authority = user
    )]
    pub user_lp: Account<'info, TokenAccount>,
    
    /// Token A vault
    /// CHECK: Validated by CP-Swap
    #[account(mut)]
    pub token_0_vault: AccountInfo<'info>,
    
    /// Token B vault
    /// CHECK: Validated by CP-Swap
    #[account(mut)]
    pub token_1_vault: AccountInfo<'info>,
    
    /// Token A mint
    /// CHECK: Used for validation
    pub token_0_mint: AccountInfo<'info>,
    
    /// Token B mint
    /// CHECK: Used for validation
    pub token_1_mint: AccountInfo<'info>,
    
    /// Vault and LP mint authority from CP-Swap
    /// CHECK: This is the CP-Swap program's authority PDA
    pub vault_lp_mint_authority: AccountInfo<'info>,
    
    /// CP-Swap program
    /// CHECK: Program ID is verified in the handler
    pub cp_swap_program: AccountInfo<'info>,
    
    /// Token program
    pub token_program: Program<'info, Token>,
    
    /// Token program 2022 (required by CP-Swap)
    /// CHECK: Validated by CP-Swap
    pub token_program_2022: AccountInfo<'info>,
    
    /// Memo program (required by CP-Swap)
    /// CHECK: Validated by CP-Swap
    pub memo_program: AccountInfo<'info>,
}

pub fn withdraw_liquidity(
    ctx: Context<WithdrawLiquidity>,
    lp_token_amount: u64,
    minimum_token_0_amount: u64,
    minimum_token_1_amount: u64,
) -> Result<()> {
    // Build the withdraw instruction data
    // CP-Swap withdraw discriminator: [183, 18, 70, 156, 148, 109, 161, 34]
    let mut data = vec![183u8, 18, 70, 156, 148, 109, 161, 34];
    data.extend_from_slice(&lp_token_amount.to_le_bytes());
    data.extend_from_slice(&minimum_token_0_amount.to_le_bytes());
    data.extend_from_slice(&minimum_token_1_amount.to_le_bytes());
    
    // Build CPI accounts
    let cpi_accounts = CpSwapWithdrawAccounts {
        owner: ctx.accounts.user.to_account_info(),
        pool_state: ctx.accounts.pool_state.to_account_info(),
        lp_mint: ctx.accounts.lp_mint.to_account_info(),
        user_token_0: ctx.accounts.user_token_0.to_account_info(),
        user_token_1: ctx.accounts.user_token_1.to_account_info(),
        user_lp: ctx.accounts.user_lp.to_account_info(),
        token_0_vault: ctx.accounts.token_0_vault.to_account_info(),
        token_1_vault: ctx.accounts.token_1_vault.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
        vault_0_mint: ctx.accounts.vault_lp_mint_authority.to_account_info(),
        memo_program: ctx.accounts.memo_program.to_account_info(),
    };
    
    // Convert to vector of AccountInfo
    let cpi_accounts_vec = vec![
        cpi_accounts.owner.clone(),
        cpi_accounts.pool_state.clone(),
        cpi_accounts.lp_mint.clone(),
        cpi_accounts.user_token_0.clone(),
        cpi_accounts.user_token_1.clone(),
        cpi_accounts.user_lp.clone(),
        cpi_accounts.token_0_vault.clone(),
        cpi_accounts.token_1_vault.clone(),
        cpi_accounts.token_program.clone(),
        cpi_accounts.token_program_2022.clone(),
        cpi_accounts.vault_0_mint.clone(),
        cpi_accounts.memo_program.clone(),
    ];
    
    // Create the instruction
    let ix = solana_program::instruction::Instruction {
        program_id: ctx.accounts.cp_swap_program.key(),
        accounts: cpi_accounts_vec
            .into_iter()
            .enumerate()
            .map(|(i, account)| {
                // First account (owner) is signer, rest are not
                solana_program::instruction::AccountMeta {
                    pubkey: account.key(),
                    is_signer: i == 0,
                    is_writable: match i {
                        0 => false,  // owner: read-only
                        _ => true,   // all others are writable
                    },
                }
            })
            .collect(),
        data,
    };
    
    // Invoke the CP-Swap withdraw instruction
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.user.to_account_info(),
            ctx.accounts.pool_state.to_account_info(),
            ctx.accounts.lp_mint.to_account_info(),
            ctx.accounts.user_token_0.to_account_info(),
            ctx.accounts.user_token_1.to_account_info(),
            ctx.accounts.user_lp.to_account_info(),
            ctx.accounts.token_0_vault.to_account_info(),
            ctx.accounts.token_1_vault.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.token_program_2022.to_account_info(),
            ctx.accounts.vault_lp_mint_authority.to_account_info(),
            ctx.accounts.memo_program.to_account_info(),
        ],
    )?;
    
    msg!("Liquidity withdrawn successfully");
    msg!("LP tokens burned: {}", lp_token_amount);
    msg!("Min token 0: {}", minimum_token_0_amount);
    msg!("Min token 1: {}", minimum_token_1_amount);
    
    Ok(())
}