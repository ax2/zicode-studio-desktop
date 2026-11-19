# Windows browser lifecycle and performance · #9

The v0.6.8 integration contains the existing recovery and suspension changes as `8caceaa8` and `1f5298db`. The native test used the frozen #156 debug executable from `5aa216b`, SHA-256 `2906a2bd523c90cb86e7fa699776e80c811d7d43a11064f8da556eeded49ddbb`. Production browser code matched `27efc9c0`. The final run used a private copy with the updated Chinese and English crash message. All processes were launched on a separate, non-input Windows desktop with synthetic profiles. Each Studio instance exited normally.

## Fault and state boundaries

1. Create two tabs in the actual Studio shell. On a local fixture, type an unsaved value, scroll, set a random in-memory JS marker, and write distinct session/local storage markers. Select the other tab, request background suspension, require `suspended: true`, then select the original. The same document marker, input, scroll offset and storage survived.
2. Save a synthetic Studio note. Crash the fixture renderer through its own DevTools target. The native status reported `processFailed`; the real Studio window displayed the updated warning. Reload from the Studio toolbar. The note and persistent site storage survived. The unsaved HTML input became empty. Studio does not collect arbitrary website form contents for recovery.
3. Simulate exit of the dedicated page-engine browser process via its own DevTools browser session. The fixture first checked that the loopback endpoint came from that profile and belonged to a descendant of the launched Studio process, separate from the shell endpoint. The shell stayed responsive, the original tab remained selected, the note was intact, and the newly created engine read the same origin's persisted data. The fixture explicitly reinstalled its network interception before reading the marker.
4. Close the recovered tab. Its native DevTools page closed and both the Studio session and Host controller list dropped its ID. Shared engine processes may outlive an individual tab.

## Measured baseline

Windows 11 build 26300, WebView2 157.0.4341.60, Ryzen 7 H 255, 16 logical processors, 31.3 GiB visible memory. Loopback debugging was enabled. All fixture HTTP responses were local; external requests were blocked. OS caches were not purged.

| Measurement | Observed |
| --- | --- |
| Fresh Studio process/profile to shell DOMContentLoaded | 2.00 s and 2.89 s |
| New tab, from button activation until Host session commits a new active ID | 20 samples per run; P50 255 / 246 ms, nearest-rank P95 314 / 328 ms |
| Append 20,000 paragraph nodes in a fragment, force layout with `offsetHeight` | 149 / 162 ms |
| Idle local fixture; 13 Studio-descendant processes including Studio | 1086 → 1000 MiB summed working set, 0.049 CPU cores over 6.64 s |
| 20,000 rendered rows, then idle | 1087 → 1087 MiB, 0.044 CPU cores over 6.71 s |
| Same page plus video playback and separate real embedded Pi RPC | 1197 → 1160 MiB, 0.080 CPU cores over 6.87 s; Pi separately used 87.8 MiB and 0.007 CPU cores |

For the tab timings, create one new tab at a time through the real shell, poll the committed session every 100 ms, then close the sample tab before the next trial. This includes polling and automation overhead. For startup, subtract the Windows process creation time from `performance.timeOrigin + navigation.domContentLoadedEventEnd` of the trusted shell.

For video, generate 22 local color frames on a 320×180 canvas at 85 ms intervals, record VP8 WebM via `MediaRecorder`, and loop the muted recording in a video element. The measured window delivered 61 `requestVideoFrameCallback` callbacks. In parallel a real packaged Pi 1.5.2 ran `--mode rpc --no-session --no-extensions --no-skills --no-prompt-templates --no-themes` with a fresh agent directory and no credentials. It answered 22 `get_state` requests during the interval. This measures concurrent local RPC; model inference, 1080p streaming and a physically cold machine were not measured.

Compute CPU cores as Δ(total user + kernel seconds) / elapsed wall seconds. Sum the working sets of the owned process tree at each end of the interval; this may double-count shared pages. Include the separately launched Pi only in its own column. For like-for-like regression triage on this host, repeat two runs and investigate if both exceed 2× the slower observed time (5.8 s startup, 656 ms new-tab P95, 324 ms for the 20k-node layout). These comparison points are provisional and do not gate releases. Failure to restore a suspended form, retain saved data, or release a closed controller is a functional regression irrespective of timing.
