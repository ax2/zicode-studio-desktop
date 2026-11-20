import assert from "node:assert/strict";

function finite(value, label) {
  assert(Number.isFinite(value) && value >= 0, `${label}: expected finite nonnegative number`);
  return value;
}

export function p95(values) {
  assert(values.length > 0, "P95 requires samples");
  const sorted = values.map((value) => finite(value, "sample")).sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function sameInput(sample, digests) {
  const { before, after } = sample;
  return (
    before?.staged === true &&
    after?.staged === true &&
    digests.has(before.digest) &&
    before.digest === after.digest &&
    before.bytes === digests.get(before.digest) &&
    after.bytes === before.bytes &&
    Number.isFinite(before.birthtimeMs) &&
    before.birthtimeMs === after.birthtimeMs &&
    Number.isFinite(before.at) &&
    Number.isFinite(after.at) &&
    after.at >= before.at
  );
}

function boundedSamples(samples, limit, maximum, label, components = ["switchMs", "clickMs"]) {
  const values = samples.map((sample) => {
    const total = finite(sample.totalMs, label);
    const parts = components.reduce((sum, key) => sum + finite(sample[key], `${label}/${key}`), 0);
    assert(Math.abs(total - parts) < 0.01, `${label}: inconsistent timing components`);
    return total;
  });
  assert(Math.max(...values) <= maximum, `${label}: operation timeout budget`);
  const value = p95(values);
  assert(value <= limit, `${label}: P95 budget`);
  return value;
}

export function evaluateCoexistence(policy, manifest, evidence) {
  assert.equal(manifest.version, 1, "manifest version");
  assert(["calibration", "independent"].includes(manifest.phase), "explicit evidence phase");
  const { machine, inventory, runs } = evidence;
  assert.equal(machine.cpu.length, 1, "one measured CPU package");
  assert.equal(machine.cpu[0].Name.trim(), policy.machine.cpu, "machine CPU changed");
  assert.equal(machine.cpu[0].NumberOfLogicalProcessors, policy.machine.logicalProcessors);
  assert.equal(
    machine.os.TotalVisibleMemorySize,
    policy.machine.memoryKiB,
    "machine memory changed",
  );
  assert.equal(machine.os.BuildNumber, policy.machine.osBuild, "OS build changed");
  assert.equal(inventory.items.length, 16, "sixteen workload images required");
  const digests = new Map(inventory.items.map((item) => [item.sha256, item.bytes]));
  assert.equal(digests.size, 16, "workload must contain distinct images");
  for (const item of inventory.items) {
    assert(/^[a-f0-9]{64}$/.test(item.sha256), "invalid workload digest");
    assert.equal(item.width, 3072);
    assert.equal(item.height, 3072);
    assert(item.bytes > 0 && item.bytes <= 24 * 1024 * 1024, "workload byte limit");
  }
  for (const key of ["exeSha256", "visualSha256"]) {
    assert(/^[a-f0-9]{64}$/i.test(manifest[key]), `invalid ${key}`);
  }
  const metrics = new Map();
  const profiles = new Set();
  const seenRuns = new Set();
  for (const pair of manifest.pairs) {
    assert(["wide", "narrow"].includes(pair.viewport), "unknown viewport");
    for (const [id, loaded] of [
      [pair.baseline, false],
      [pair.loaded, true],
    ]) {
      assert(!seenRuns.has(id), "a run cannot be reused as an independent replicate");
      seenRuns.add(id);
      const { result, launch, window, resources } = runs[id];
      assert.equal(result.run, id, "run identity");
      assert.equal(result.passed, true, `${id}: runtime script failed`);
      assert.deepEqual(result.errors, [], `${id}: runtime errors`);
      assert.equal(result.loaded, loaded, `${id}: load condition`);
      assert.equal(result.paidCalls, 0, `${id}: unexpected paid call`);
      assert.equal(result.managedOriginals, loaded ? 16 : 0, `${id}: original count`);
      assert.equal(result.identity.title, "ZiCode Studio Desktop", `${id}: app title`);
      const url = new URL(result.identity.url);
      assert.equal(url.hostname, "127.0.0.1", `${id}: owned local UI required`);
      assert(url.pathname.startsWith("/app/workspaces/"), `${id}: workspace route`);
      assert.deepEqual(
        result.identity.viewport,
        policy.viewports[pair.viewport],
        `${id}: viewport`,
      );
      assert.equal(
        launch.sha256.toLowerCase(),
        manifest.exeSha256.toLowerCase(),
        `${id}: EXE drift`,
      );
      assert.equal(
        result.served.toLowerCase(),
        manifest.visualSha256.toLowerCase(),
        `${id}: UI drift`,
      );
      assert(!profiles.has(launch.profile), "each run needs fresh independent profile");
      profiles.add(launch.profile);
      assert(Number.isFinite(Date.parse(launch.startedAt)), `${id}: missing launch time`);
      if (manifest.phase === "independent") {
        assert(
          Date.parse(launch.startedAt) > Date.parse(policy.frozenAt),
          `${id}: predates gate freeze`,
        );
      }
      assert.equal(window.processId, launch.processId, `${id}: exit identity`);
      assert.equal(window.normalExit, true, `${id}: missing normal exit`);
      assert.equal(window.onSeparateDesktop, true, `${id}: background desktop required`);
      assert.equal(window.appIsForeground, false, `${id}: app stole foreground`);
      assert.equal(window.forcedTermination, false, `${id}: forced termination`);
      assert.equal(result.initialResources.nativeEndpoint, null, `${id}: not first native use`);
      const firstPageMs = finite(result.cold.firstPageMs, `${id}: first page`);
      assert(firstPageMs <= policy.firstPageMs, `${id}: first page budget`);
      if (loaded) assert(sameInput(result.cold, digests), `${id}: cold load overlap missing`);
      const blocks = result.groups.filter((group) => /^block-[1-3]$/.test(group.label));
      const count = pair.viewport === "wide" ? 3 : 1;
      assert.deepEqual(
        blocks.map((group) => group.label),
        Array.from({ length: count }, (_, i) => `block-${i + 1}`),
        `${id}: required interaction blocks`,
      );
      const expectedLabels = [...blocks.map((group) => group.label), ...(loaded ? ["after"] : [])];
      assert.deepEqual(
        result.groups.map((group) => group.label),
        expectedLabels,
        `${id}: unexpected/missing group`,
      );
      for (const group of result.groups) {
        assert.equal(group.samples.length, 20, `${id}/${group.label}: sample count`);
        boundedSamples(
          group.samples,
          policy.tabP95Ms,
          policy.maxOperationMs,
          `${id}/${group.label}`,
        );
      }
      const samples = blocks.flatMap((group) => group.samples);
      const tabP95Ms = p95(samples.map((sample) => sample.totalMs));
      const overlap = samples.filter((sample) => sameInput(sample, digests));
      if (loaded) {
        assert(
          overlap.length >= samples.length * policy.minOverlapFraction,
          `${id}: insufficient actual import overlap`,
        );
        boundedSamples(overlap, policy.tabP95Ms, policy.maxOperationMs, `${id}: overlap`);
      }
      let overlayP95Ms = null;
      if (pair.viewport === "narrow") {
        assert.equal(result.overlays.length, 20, `${id}: menu sample count`);
        overlayP95Ms = boundedSamples(
          result.overlays,
          policy.overlayP95Ms,
          policy.maxOperationMs,
          `${id}: menu`,
          ["hideMs", "restoreMs"],
        );
        assert(
          p95(result.overlays.map((sample) => sample.hideMs)) <= policy.overlayHideP95Ms,
          `${id}: hide budget`,
        );
        assert(
          p95(result.overlays.map((sample) => sample.restoreMs)) <= policy.overlayRestoreP95Ms,
          `${id}: restore budget`,
        );
        if (loaded) {
          const menuOverlap = result.overlays.filter((sample) => sameInput(sample, digests));
          assert(
            menuOverlap.length >= 20 * policy.minOverlapFraction,
            `${id}: insufficient menu overlap`,
          );
          boundedSamples(
            menuOverlap,
            policy.overlayP95Ms,
            policy.maxOperationMs,
            `${id}: menu overlap`,
            ["hideMs", "restoreMs"],
          );
        }
      }
      const phases = [
        "initial",
        "first",
        ...blocks.map((group) => group.label),
        ...(loaded ? ["import-start", "after"] : []),
        ...(pair.viewport === "narrow" ? ["overlay"] : []),
      ];
      assert.deepEqual(
        resources.map((resource) => resource.phase).sort(),
        phases.sort(),
        `${id}: resource checkpoints missing/duplicated`,
      );
      let workers = 0;
      for (const resource of resources) {
        assert.equal(resource.run, id, `${id}: resource run mismatch`);
        assert(
          resource.processes.some((process) => process.id === launch.processId),
          `${id}: app memory observation missing`,
        );
        const observedBytes = resource.processes.reduce(
          (sum, process) => sum + finite(process.privateBytes, `${id}: process memory`),
          0,
        );
        assert(
          observedBytes > 0 && observedBytes === resource.privateBytes,
          `${id}: memory total inconsistent or unknown`,
        );
        assert.deepEqual(resource.concurrentBuilds, [], `${id}: compiler/test contamination`);
        assert(resource.decoderWorkers.length <= 1, `${id}: decoder concurrency`);
        for (const worker of resource.decoderWorkers)
          assert.equal(worker.ParentProcessId, launch.processId, `${id}: foreign Worker`);
        workers += resource.decoderWorkers.length;
        assert(
          finite(resource.privateBytes, `${id}: memory`) / 1048576 <= policy.privateCheckpointMiB,
          `${id}: private memory budget`,
        );
      }
      assert(
        workers >= (loaded ? policy.minWorkerCheckpoints : 0),
        `${id}: insufficient Worker observations`,
      );
      if (!loaded) assert.equal(workers, 0, `${id}: unexpected baseline Worker`);
      const interactionMemory = resources.filter(
        (resource) => resource.phase.startsWith("block-") || resource.phase === "overlay",
      );
      const privateMiB = Math.max(
        ...interactionMemory.map((resource) => resource.privateBytes / 1048576),
      );
      metrics.set(id, {
        firstPageMs,
        tabP95Ms,
        overlayP95Ms,
        privateMiB,
        overlap: overlap.length,
        samples: samples.length,
      });
    }
    const baseline = metrics.get(pair.baseline);
    const loaded = metrics.get(pair.loaded);
    for (const key of ["tabP95Ms", ...(pair.viewport === "narrow" ? ["overlayP95Ms"] : [])]) {
      assert(
        loaded[key] <= baseline[key] * policy.loadedP95Ratio,
        `${pair.loaded}: relative ${key} regression`,
      );
      assert(
        loaded[key] - baseline[key] <= policy.loadedP95DeltaMs,
        `${pair.loaded}: ${key} delta regression`,
      );
    }
    assert(
      loaded.firstPageMs - baseline.firstPageMs <= policy.loadedFirstPageDeltaMs,
      `${pair.loaded}: first page delta regression`,
    );
    assert(
      loaded.privateMiB - baseline.privateMiB <= policy.loadedPrivateDeltaMiB,
      `${pair.loaded}: private memory delta regression`,
    );
  }
  assert.equal(
    manifest.pairs.filter((pair) => pair.viewport === "wide").length,
    policy.widePairs,
    "wide pair count",
  );
  assert.equal(
    manifest.pairs.filter((pair) => pair.viewport === "narrow").length,
    policy.narrowPairs,
    "narrow pair count",
  );
  return {
    metricsPassed: true,
    independent: manifest.phase === "independent",
    phase: manifest.phase,
    metrics: Object.fromEntries(metrics),
  };
}
