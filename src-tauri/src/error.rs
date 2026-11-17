//! Application-wide error type. Serialized to the frontend as a short public
//! message; internal details (paths, SQL) go to the log, never to the UI.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("internal state unavailable")]
    StatePoisoned,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        log::warn!("command failed: {self}");
        let public = match self {
            AppError::Database(_) => "A local database operation failed.".to_string(),
            AppError::Json(_) => "Stored data could not be read.".to_string(),
            AppError::Io(_) => "A file operation failed.".to_string(),
            AppError::InvalidInput(msg) => msg.clone(),
            AppError::StatePoisoned => "Internal state is unavailable; restart Vaalytics.".to_string(),
        };
        serializer.serialize_str(&public)
    }
}

pub type AppResult<T> = Result<T, AppError>;
