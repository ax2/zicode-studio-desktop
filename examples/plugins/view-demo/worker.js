zicode.capabilities.register("example.echo", (input, call) => ({
  text: input.text,
  sceneId: call.sceneId,
  runtime: "independent",
}));

zicode.commands.register("example.echoCommand", (args, call) => ({
  message: `${args.message ?? "Command executed"} · ${call.sceneId} · process independent`,
}));
