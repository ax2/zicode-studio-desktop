"""Isolated CI only: run the two public Argos Translate 1.9 packages on CPU."""
import base64, hashlib, json, os, pathlib, sys, urllib.request, zipfile, shutil
assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
root = pathlib.Path(os.environ["RUNNER_TEMP"]) / "q56-models"
if sys.argv[1] == "prepare":
    root.mkdir()
    for pair in ("en_zh", "zh_en"):
        folder = root / pair
        folder.mkdir()
        package = folder / "download.zip"
        with urllib.request.urlopen(f"https://argos-net.com/v1/translate-{pair}-1_9.argosmodel", timeout=120) as src, package.open("wb") as dst:
            shutil.copyfileobj(src,dst)
        with package.open("rb") as f:
            print(pair, hashlib.file_digest(f,"sha256").hexdigest(), flush=True)
        with zipfile.ZipFile(package) as z:
            for item in z.infolist():
                relative = pathlib.PurePosixPath(item.filename)
                if item.is_dir() or relative.is_absolute() or ".." in relative.parts: continue
                parts = relative.parts[1:]
                if not parts or not (parts[0]=="model" or parts[0] in ("sentencepiece.model","metadata.json")): continue
                dst = folder.joinpath(*parts)
                assert dst.resolve().is_relative_to(folder.resolve()) and item.file_size < 512*1024**2
                dst.parent.mkdir(exist_ok=True,parents=True)
                with dst.open("wb") as stream, z.open(item) as source: shutil.copyfileobj(source,stream)
        assert (folder/"model/model.bin").is_file() and (folder/"sentencepiece.model").is_file()
else:
    import ctranslate2, sentencepiece
    pair = sys.argv[1]
    assert pair in ("en_zh","zh_en")
    folder = root/pair
    text = base64.b64decode(sys.argv[2]).decode()
    tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(folder/"sentencepiece.model"))
    decoder = ctranslate2.Translator(str(folder/"model"),device="cpu",compute_type="int8",inter_threads=1,intra_threads=2)
    tokens = tokenizer.encode(text,out_type=str)
    result = decoder.translate_batch([tokens],beam_size=4)[0].hypotheses[0]
    print(base64.b64encode(tokenizer.decode(result).encode()).decode())
