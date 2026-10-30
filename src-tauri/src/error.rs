use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("`git {args}` failed: {stderr}")]
    Git { args: String, stderr: String },
    #[error("unexpected git output: {0}")]
    Parse(String),
    #[error("{0} is not inside a git repository")]
    NotARepo(String),
    #[error("invalid config: {0}")]
    Config(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

// Tauri sends command errors to the frontend as JSON; a plain message is all the UI needs.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
