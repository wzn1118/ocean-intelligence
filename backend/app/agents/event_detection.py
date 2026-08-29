from app.models import DetectionRequest, DetectionResult
from app.scientific_models.anomaly import detect_anomaly


class OceanEventDetectionAgent:
    """Delegates numerical detection to the scientific model layer."""

    def analyze(self, request: DetectionRequest) -> DetectionResult:
        return DetectionResult(**detect_anomaly(request))

