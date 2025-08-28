use anchor_lang::prelude::*;

#[error_code]
pub enum ContinuumError {
    #[msg("Invalid sequence number")]
    InvalidSequence,

    #[msg("Order already executed")]
    OrderAlreadyExecuted,

    #[msg("Order not found")]
    OrderNotFound,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Pool not registered")]
    PoolNotRegistered,

    #[msg("Pool already registered")]
    PoolAlreadyRegistered,

    #[msg("Emergency pause is active")]
    EmergencyPause,

    #[msg("Invalid pool configuration")]
    InvalidPoolConfig,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Invalid order status")]
    InvalidOrderStatus,
}
