use anchor_lang::prelude::*;

#[account]
pub struct FifoState {
    pub current_sequence: u64,
    pub admin: Pubkey,
    pub emergency_pause: bool,
}

impl FifoState {
    pub const LEN: usize = 8 + 8 + 32 + 1;
}

#[account]
pub struct CpSwapPoolRegistry {
    pub pool_id: Pubkey,
    pub token_0: Pubkey,
    pub token_1: Pubkey,
    pub continuum_authority: Pubkey,
    pub created_at: i64,
    pub is_active: bool,
}

impl CpSwapPoolRegistry {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 1;
}

#[account]
pub struct OrderState {
    pub sequence: u64,
    pub user: Pubkey,
    pub pool_id: Pubkey,
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub is_base_input: bool,
    pub status: OrderStatus,
    pub submitted_at: i64,
    pub executed_at: Option<i64>,
}

impl OrderState {
    pub const LEN: usize = 8 + 8 + 32 + 32 + 8 + 8 + 1 + 1 + 8 + 9;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Pending,
    Executed,
    Cancelled,
    Failed,
}

#[event]
pub struct OrderSubmitted {
    pub sequence: u64,
    pub user: Pubkey,
    pub pool_id: Pubkey,
    pub amount_in: u64,
    pub is_base_input: bool,
}

#[event]
pub struct OrderExecuted {
    pub sequence: u64,
    pub user: Pubkey,
    pub amount_out: u64,
    pub executor: Pubkey,
}

#[event]
pub struct OrderCancelled {
    pub sequence: u64,
    pub user: Pubkey,
}

#[event]
pub struct PoolRegistered {
    pub pool_id: Pubkey,
    pub continuum_authority: Pubkey,
}
