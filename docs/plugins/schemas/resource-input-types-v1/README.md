# Resource input types v1

Required profile: `resource.input.types.v1 = 1.0.0-preview.1`.

Each resource receiving capability declares `resourceInputMimeTypes` as a finite, non-empty array of 1–32 unique canonical MIME types. Values are lowercase ASCII `type/subtype` tokens without wildcards or parameters. The list declares accepted bytes; it does not authorize access. A provider must not claim conversions here.

Studio sends `resourceMimeType` on typed resource-directory queries and includes it in the catalog revision used to load the selected capability. Transfer preparation and confirmation recheck the exact type against the current manifest. The manifest is part of the Host receiver proof, and the resource Worker checks declared types again before execution.

Legacy manifests may omit the profile and declaration. They remain usable in existing non-transfer entry points but are unavailable in the compatible resource-transfer catalog until they adopt this contract.

See [`capability.schema.json`](capability.schema.json) and [`../../resource-input-type-declaration.md`](../../resource-input-type-declaration.md).
