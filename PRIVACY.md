# Privacy

Knitspace is local-first. It does not include analytics or an account system.

- Sources, crops, Markdown and review data live in the user-selected vault.
- An AI request is only made after a user action. v0.1 sends selected text, not whole source files.
- API keys are stored through the operating-system credential store and are excluded from backups and Git.
- Optional model engines are installed separately and may be removed without deleting learning material.
- Window capture is opt-in and session-scoped. Knitspace registers `Ctrl+Alt+P` only after the user starts a rolling-capture session, captures only the foreground window when the shortcut is pressed, stores PNG files in the local app cache, keeps at most 48 cached captures, and unregisters the shortcut when the session or page ends.
- Offline OCR uses the Windows `Windows.Media.Ocr` API and only the language packs already installed on the device. The selected image is decoded and recognized locally, is not uploaded, and is not added to the Vault unless the user explicitly saves the confirmed text as a note or question. Images over 50 MB are rejected before renderer preview; oversized dimensions are downscaled in memory for recognition without modifying the source file.
- Local transcription runs only after explicit confirmation and uses the user-selected whisper.cpp-compatible executable, model, FFmpeg, input path, and output directory. Media is not uploaded or loaded into the WebView. Temporary audio and incomplete subtitle drafts are deleted after completion, cancellation, or a reported process failure; the finished SRT is written as a new file.
