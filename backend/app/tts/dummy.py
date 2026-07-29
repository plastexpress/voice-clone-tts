"""Motor sintético — nenhuma GPU, nenhum modelo, nenhum download.

Serve para exercitar toda a stack (token, fila, cache, Opus, interface) numa
máquina sem CUDA. O áudio é um zumbido modulado, determinístico a partir do
texto: o mesmo texto produz sempre a mesma forma de onda.
"""

from __future__ import annotations

import hashlib
import math
import random
import struct
import time
import wave

from .base import SynthesisRequest, SynthesisResult, TTSEngine

SAMPLE_RATE = 24000
CHARS_PER_SECOND = 14.0


class DummyEngine(TTSEngine):
    name = "dummy"

    def __init__(self) -> None:
        self._loaded = False

    @property
    def model_id(self) -> str:
        return "dummy/sine-babble"

    @property
    def device(self) -> str:
        return "cpu"

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def load(self) -> None:
        self._loaded = True

    def synthesize(self, request: SynthesisRequest) -> SynthesisResult:
        self.load()

        seed_source = f"{request.text}|{request.reference_audio}|{request.seed}"
        seed = int(hashlib.sha256(seed_source.encode("utf-8")).hexdigest()[:12], 16)
        rng = random.Random(seed)

        duration_s = max(0.6, min(len(request.text) / CHARS_PER_SECOND, 120.0))
        if request.duration_tokens:
            duration_s = max(0.3, request.duration_tokens / 12.5)

        total_samples = int(duration_s * SAMPLE_RATE)
        base_freq = 110.0 + rng.random() * 60.0  # timbre "por voz"
        syllable_hz = 4.2 + rng.random() * 1.6

        frames = bytearray()
        for index in range(total_samples):
            t = index / SAMPLE_RATE
            # envelope de sílabas + fade in/out
            envelope = 0.5 * (1.0 - math.cos(2 * math.pi * syllable_hz * t))
            envelope *= min(1.0, t / 0.05, (duration_s - t) / 0.08)
            envelope = max(0.0, envelope)

            vibrato = 1.0 + 0.03 * math.sin(2 * math.pi * 5.0 * t)
            f0 = base_freq * vibrato
            sample = (
                0.55 * math.sin(2 * math.pi * f0 * t)
                + 0.25 * math.sin(2 * math.pi * f0 * 2 * t)
                + 0.12 * math.sin(2 * math.pi * f0 * 3 * t)
            )
            value = int(max(-1.0, min(1.0, sample * envelope * 0.6)) * 32767)
            frames += struct.pack("<h", value)

        # simula um pouco de latência de inferência
        time.sleep(min(0.4, duration_s * 0.05))

        request.output_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(request.output_path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(SAMPLE_RATE)
            handle.writeframes(bytes(frames))

        return SynthesisResult(
            path=request.output_path,
            sample_rate=SAMPLE_RATE,
            channels=1,
            duration_ms=int(duration_s * 1000),
            model_id=self.model_id,
            engine=self.name,
        )
