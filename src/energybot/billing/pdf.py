from energybot.billing.barcode import decode_bill_barcode
from energybot.billing.bill_numbers import BillNumbers
from energybot.logging import get_logger

log = get_logger(__name__)

# Iranian e-bills are 1–2 pages; cap rendering so a pathological PDF can't stall a turn.
_MAX_PAGES = 5
# Bills carry a small Code-128 barcode; render at high DPI so zbar can resolve the bars.
_RENDER_DPI = 300


def decode_bill_from_pdf(pdf_bytes: bytes) -> BillNumbers | None:
    """Render each page of a bill PDF to an image and read its barcode.

    Reuses the photo pipeline (``decode_bill_barcode``): the PDF a user uploads
    embeds the same barcode image as a photographed bill, so rasterising and
    decoding it gives identical results.
    """
    try:
        import fitz  # PyMuPDF
    except Exception as e:  # noqa: BLE001 - missing system lib must not crash a turn
        log.warning("pdf_lib_unavailable", error=str(e))
        return None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None
    try:
        for i in range(min(doc.page_count, _MAX_PAGES)):
            pix = doc.load_page(i).get_pixmap(dpi=_RENDER_DPI)
            bn = decode_bill_barcode(pix.tobytes("png"))
            if bn is not None:
                return bn
    finally:
        doc.close()
    return None
