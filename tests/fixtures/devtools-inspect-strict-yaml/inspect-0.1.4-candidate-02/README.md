# ZiDevTools Inspect 0.1.4 candidate

Studio YAML and JSON conversion rejects duplicate keys, non-finite numeric values and numbers that cannot be written without changing their decimal value. Exact signed and unsigned 64-bit integers are preserved. Both directions use at most 8 KiB of input and the existing 48 KiB result contract and Worker limits. Dense YAML may exhaust the existing Worker computation budget.

The eight capability identities and original Host profiles are preserved. The standalone conversion keeps its existing compatibility behavior. Inspect 0.1.3 remains frozen. This candidate is unsigned.
