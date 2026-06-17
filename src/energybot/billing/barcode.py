import io
from energybot.billing.bill_numbers import BillNumbers, parse_bill_numbers
from energybot.logging import get_logger

log = get_logger(__name__)


def decode_bill_barcode(image_bytes: bytes) -> BillNumbers | None:
    try:
        from PIL import Image
        from pyzbar.pyzbar import decode as zbar_decode
    except Exception as e:  # noqa: BLE001 - missing system lib must not crash a turn
        log.warning("barcode_lib_unavailable", error=str(e))
        return None
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception:
        return None
    for sym in zbar_decode(img):
        try:
            raw = sym.data.decode("ascii", "ignore")
            return parse_bill_numbers(raw)
        except ValueError:
            continue
    return None
