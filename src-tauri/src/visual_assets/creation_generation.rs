//! Versioned still-image capabilities and parameters. No network discovery or secrets.
use super::{Input, Result, Settings};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) enum Profile {
    #[serde(rename = "basic-v1")]
    Basic,
    #[serde(rename = "gpt-image-v1")]
    GptImage,
    #[serde(rename = "gpt-image-26-v1")]
    GptImage26,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Capabilities {
    pub profile: Profile,
    pub source: &'static str,
    pub sizes: Vec<&'static str>,
    pub qualities: Vec<&'static str>,
    pub formats: Vec<&'static str>,
    pub backgrounds: Vec<&'static str>,
    pub complexities: Vec<&'static str>,
    pub compression: bool,
}

pub(crate) fn capabilities(settings: &Settings) -> Capabilities {
    // Only exact official endpoints/model IDs get built-in capabilities. A custom
    // provider may explicitly declare a versioned compatibility profile in settings.
    let official = reqwest::Url::parse(&settings.base_url).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("api.openai.com")
            && url.port_or_known_default() == Some(443)
            && url.path().trim_end_matches('/') == "/v1"
    });
    let known = if official {
        match settings.model.as_str() {
            "gpt-image-2.6-flare" | "gpt-image-2.6-sunburst" => Some(Profile::GptImage26),
            "gpt-image-1.5"
            | "gpt-image-1-mini"
            | "gpt-image-2.5-sunburst"
            | "gpt-image-2.5-flare"
            | "gpt-image-2.5-sunburst-2026-09-08"
            | "gpt-image-2.5-flare-2026-09-08" => Some(Profile::GptImage),
            _ => None,
        }
    } else {
        None
    };
    let (profile, source) = if let Some(profile) = settings.capability_profile {
        (profile, "configured")
    } else if let Some(profile) = known {
        (profile, "built-in")
    } else {
        (Profile::Basic, "unlisted")
    };
    let advanced = profile != Profile::Basic;
    Capabilities {
        profile,
        source,
        sizes: if advanced {
            vec!["auto", "1024x1024", "1536x1024", "1024x1536"]
        } else {
            vec![]
        },
        qualities: if advanced {
            vec!["auto", "low", "medium", "high"]
        } else {
            vec![]
        },
        formats: if advanced {
            vec!["png", "jpeg", "webp"]
        } else {
            vec![]
        },
        backgrounds: if advanced {
            vec!["auto", "opaque", "transparent"]
        } else {
            vec![]
        },
        complexities: if profile == Profile::GptImage26 {
            vec!["low", "medium", "high"]
        } else {
            vec![]
        },
        compression: advanced,
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Mode {
    Text,
    Image,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Options {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub complexity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compression: Option<u8>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Generation {
    pub mode: Mode,
    pub options: Options,
}
impl Generation {
    pub fn validate(&self, settings: &Settings, input: &Input) -> Result<()> {
        if input.style.is_some()
            || input.clothing.is_some()
            || (self.mode == Mode::Text) != input.person.is_none()
        {
            return Err("visual_assets_creation_input_invalid".into());
        }
        let caps = capabilities(settings);
        let options = &self.options;
        for (selected, allowed) in [
            (&options.size, &caps.sizes),
            (&options.quality, &caps.qualities),
            (&options.format, &caps.formats),
            (&options.background, &caps.backgrounds),
            (&options.complexity, &caps.complexities),
        ] {
            if selected
                .as_ref()
                .is_some_and(|value| !allowed.contains(&value.as_str()))
            {
                return Err("visual_assets_creation_parameter_unsupported".into());
            }
        }
        if options.background.as_deref() == Some("transparent")
            && options.format.as_deref() == Some("jpeg")
            || options.compression.is_some_and(|value| {
                value > 100
                    || !caps.compression
                    || !matches!(options.format.as_deref(), Some("jpeg" | "webp"))
            })
        {
            return Err("visual_assets_creation_parameter_unsupported".into());
        }
        Ok(())
    }
    pub fn workflow(&self) -> &'static str {
        match self.mode {
            Mode::Text => "text-to-image",
            Mode::Image => "image-to-image",
        }
    }
    pub fn parameters(&self) -> Map<String, Value> {
        let options = &self.options;
        let mut fields = Map::new();
        for (name, value) in [
            ("size", &options.size),
            ("quality", &options.quality),
            ("output_format", &options.format),
            ("background", &options.background),
            ("complexity", &options.complexity),
        ] {
            if let Some(value) = value {
                fields.insert(name.into(), json!(value));
            }
        }
        if let Some(value) = options.compression {
            fields.insert("output_compression".into(), json!(value));
        }
        fields
    }
}
