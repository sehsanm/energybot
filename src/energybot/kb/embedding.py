from energybot.providers.base import EmbeddingRequest


class EmbeddingService:
    def __init__(self, *, router, batch_size: int = 64):
        self._router = router
        self._batch = batch_size

    async def embed_all(self, inputs: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(inputs), self._batch):
            batch = inputs[i:i + self._batch]
            r = await self._router.embed(call_type="embed", req=EmbeddingRequest(model="", inputs=batch))
            out.extend(r.vectors)
        return out
