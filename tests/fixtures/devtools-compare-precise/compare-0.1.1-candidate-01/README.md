# ZiDevTools Compare 0.1.1 candidate

JSON diff compares exact decimal values in both array modes and writes unchanged numeric tokens in before/after values. The verified original numeric-kind and signed-zero policies are preserved. Two UTF-8 JSON inputs, each at most 8 KiB, retain the 48 KiB request/result contract. The existing JSON path query keeps its previous numeric policy.

The package keeps the previous capability IDs and permission contract. This Windows-tested candidate is unsigned. Original fixtures inherited from 0.1.0 are reference vectors for the existing contract.
