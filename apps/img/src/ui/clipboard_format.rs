use super::*;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::io::Read;

const MAX_BYTES: usize = 24 * 1024 * 1024;
const MAX_ASSETS: usize = 16 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Transfer {
    format: String,
    version: u32,
    operations: Vec<Step>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Step {
    kind: String,
    values: Vec<String>,
    enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    asset: Option<Asset>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    extension: String,
    data: String,
}
pub(super) struct Decoded {
    pub operation: Operation,
    pub enabled: bool,
    pub asset: Option<(String, Vec<u8>)>,
}

pub(super) fn encode(cards: &[Card]) -> Result<String> {
    let mut bytes = 0;
    let mut operations = vec![];
    for card in cards {
        let asset = if let Operation::Overlay { path, .. } = &card.operation
            && !path.is_empty()
        {
            let mut data = vec![];
            std::fs::File::open(path)
                .with_context(|| format!("Cannot copy image {path}"))?
                .take((MAX_ASSETS + 1) as u64)
                .read_to_end(&mut data)?;
            bytes += data.len();
            ensure!(bytes <= MAX_ASSETS, "Copied image assets exceed 16 MiB");
            let extension = match image::guess_format(&data)? {
                image::ImageFormat::Png => "png",
                image::ImageFormat::Gif => "gif",
                image::ImageFormat::Jpeg => "jpg",
                _ => anyhow::bail!("Unsupported clipboard image"),
            };
            Some(Asset {
                extension: extension.into(),
                data: STANDARD.encode(data),
            })
        } else {
            None
        };
        operations.push(Step {
            kind: card.operation.id().into(),
            values: card
                .operation
                .parameters()
                .into_iter()
                .map(|p| p.value)
                .collect(),
            enabled: card.enabled,
            asset,
        });
    }
    let text = serde_json::to_string(&Transfer {
        format: "img.operations".into(),
        version: 1,
        operations,
    })?;
    ensure!(
        text.len() <= MAX_BYTES,
        "Operations exceed the clipboard size limit"
    );
    Ok(text)
}
pub(super) fn decode(text: &str) -> Result<Vec<Decoded>> {
    ensure!(
        text.len() <= MAX_BYTES,
        "Clipboard operations exceed 24 MiB"
    );
    let transfer: Transfer =
        serde_json::from_str(text).context("Clipboard does not contain img operations")?;
    ensure!(
        transfer.format == "img.operations" && transfer.version == 1,
        "Unsupported img clipboard format"
    );
    ensure!(
        !transfer.operations.is_empty() && transfer.operations.len() <= img::MAX_OPERATIONS,
        "Clipboard must contain 1–{} operations",
        img::MAX_OPERATIONS
    );
    let catalog = Operation::catalog();
    let mut bytes = 0;
    transfer
        .operations
        .into_iter()
        .map(|step| {
            let operation = catalog
                .iter()
                .find(|op| op.id() == step.kind)
                .with_context(|| format!("Unknown operation: {}", step.kind))?
                .with_parameters(&step.values)?;
            let asset = step
                .asset
                .map(|asset| -> Result<_> {
                    ensure!(
                        matches!(operation, Operation::Overlay { .. }),
                        "Only image overlays may contain assets"
                    );
                    ensure!(
                        ["png", "gif", "jpg"].contains(&asset.extension.as_str()),
                        "Unsupported clipboard asset type"
                    );
                    let data = STANDARD
                        .decode(asset.data)
                        .context("Invalid clipboard image data")?;
                    bytes += data.len();
                    ensure!(bytes <= MAX_ASSETS, "Clipboard image assets exceed 16 MiB");
                    Ok((asset.extension, data))
                })
                .transpose()?;
            Ok(Decoded {
                operation,
                enabled: step.enabled,
                asset,
            })
        })
        .collect()
}
