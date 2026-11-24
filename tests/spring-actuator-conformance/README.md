# Spring Boot Actuator Windows conformance

Runs the frozen `com.zicode.devtools.spring-actuator` 0.1.1 and 0.1.3 candidates against two Spring Boot 3.5.11 processes on Windows. Both bind to ephemeral IPv4 loopback ports and expose only the read-only `health`, `info`, and `metrics` endpoints. One instance reports `UP` and the other reports `DOWN`. The processes use generated fixture data.

Use JDK 21, Maven and PowerShell 7.4 or later. From the Studio repository root, compile the fixture and the Studio test executable:

```powershell
Push-Location tests/spring-actuator-conformance
mvn compile org.apache.maven.plugins:maven-dependency-plugin:3.7.0:build-classpath '-Dmdep.outputFile=target/runtime-classpath.txt'
Pop-Location
cargo test --manifest-path src-tauri/Cargo.toml --bin zicode-studio-desktop --no-run
```

Use the exact executable reported by Cargo:

```powershell
pwsh -NoProfile -File tests/spring-actuator-conformance/verify.ps1 -TestBinary 'target/debug/deps/zicode_studio_desktop-<hash>.exe' -EvidenceDirectory .cache/task-scratch/spring-actuator-conformance
```

The script runs the synthetic and real-service Host tests. It checks the fixture logs for exactly four confirmed GETs per candidate without cookies or authorization headers. The Host test covers plugin installation and enablement, denial before permission, decline, one-time confirmation, the three response shapes, a `503` health response and disabled View access. For 0.1.3, the same isolated Host must also list the four enabled directory entries with their expected operation, plugin and View IDs and plugin version. The capability directory must exclude them and a capability-detail request for the health entry must fail without making a service request. The runner keeps both fixture logs and the Host result in a separate evidence directory per run and stops its own Java processes.

The test drives the trusted Host confirmation API directly. Native View interaction, remote HTTPS deployments, authenticated Actuator, detailed diagnostics, export and Pi integration remain separate from this receipt.
