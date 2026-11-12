extends SceneTree


func _initialize() -> void:
	verify.call_deferred()


func verify() -> void:
	var arguments := OS.get_cmdline_user_args()
	if arguments.size() != 4 or arguments[1] not in ["once", "loop"]:
		fail("Expected the scene resource path, playback mode and two frame durations")
		return
	var expect_loop := arguments[1] == "loop"
	var first_duration := arguments[2].to_float()
	var second_duration := arguments[3].to_float()
	var scene := load(arguments[0]) as PackedScene
	if scene == null:
		fail("Preview scene could not be loaded")
		return
	var preview := scene.instantiate()
	var clip := preview.get_node_or_null("Clip") as AnimatedSprite2D
	if clip == null or clip.centered or clip.offset != Vector2(-2, -2):
		preview.free()
		fail("Clip origin does not match the anchor")
		return
	var frames := clip.sprite_frames
	if frames == null or frames.get_frame_count(&"default") != 2:
		preview.free()
		fail("Expected two frames")
		return
	var fps := frames.get_animation_speed(&"default")
	if fps <= 0.0 or frames.get_animation_loop(&"default") != expect_loop or not (
		is_equal_approx(frames.get_frame_duration(&"default", 0) / fps, first_duration)
		and is_equal_approx(frames.get_frame_duration(&"default", 1) / fps, second_duration)
	):
		preview.free()
		fail("Frame durations or loop flag changed")
		return
	for index in range(2):
		var texture := frames.get_frame_texture(&"default", index)
		if texture == null or texture.get_size() != Vector2(5, 4):
			preview.free()
			fail("Frame texture is missing or has the wrong dimensions")
			return

	root.add_child(preview)
	await process_frame
	if not clip.is_playing() or clip.frame != 0:
		fail("Preview did not start on the first frame: " + playback_state(clip))
		return
	var elapsed := 0.0
	var second_frame_at := -1.0
	var clip_end_at := -1.0
	for _frame in range(60):
		var delta := clip.get_process_delta_time()
		await process_frame
		elapsed += delta
		if second_frame_at < 0.0 and clip.frame == 1 and clip.is_playing():
			second_frame_at = elapsed
		var completed := clip.frame == 0 and clip.is_playing() if expect_loop else (
			clip.frame == 1 and not clip.is_playing()
		)
		if second_frame_at >= 0.0 and completed:
			clip_end_at = elapsed
			break
	# Playback state is observed on process-frame boundaries, about 10 ms apart.
	if absf(second_frame_at - first_duration) > 0.030 or (
		absf(clip_end_at - first_duration - second_duration) > 0.030
	):
		fail("Unexpected transitions at %.6f s and %.6f s: %s" % [
			second_frame_at, clip_end_at, playback_state(clip)
		])
		return
	print("animation playback verified: second frame at %.6f s, %s at %.6f s" % [
		second_frame_at, "loop" if expect_loop else "stop", clip_end_at
	])
	quit()


func playback_state(clip: AnimatedSprite2D) -> String:
	return "frame=%d progress=%.6f playing=%s delta=%.6f" % [
		clip.frame, clip.frame_progress, clip.is_playing(), clip.get_process_delta_time()
	]


func fail(message: String) -> void:
	push_error(message)
	quit(1)
