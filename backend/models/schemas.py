from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class QueryRequest(BaseModel):
    message: str


class SafetyVerdict(BaseModel):
    verdict: str  # SAFE | WARNING | FLAGGED
    confidence: float = Field(ge=0.0, le=1.0)
    flags: list[str]
    explanation: str
    hipaa_risk: bool
    flagged_claims: list[str]


class QueryResponse(BaseModel):
    gemini_response: str
    safety: SafetyVerdict
    session_id: str
    timestamp: str


class ProbeRequest(BaseModel):
    topic: Optional[str] = "medication dosage"


class TrilemmaScores(BaseModel):
    forgetting_score: float = Field(ge=0.0, le=1.0)
    utility_score: float = Field(ge=0.0, le=1.0)
    detectability_score: float = Field(ge=0.0, le=1.0)
    trilemma_violation: bool
    probe_results: list[dict]


class ReportRequest(BaseModel):
    session_ids: Optional[list[str]] = None  # None means all sessions


class ComplianceReport(BaseModel):
    report: str
    total_queries: int
    flagged_count: int
    warning_count: int
    safe_count: int
    hipaa_violations: int
    generated_at: str


class SessionLog(BaseModel):
    session_id: str
    timestamp: str
    user_message: str
    gemini_response: str
    safety: SafetyVerdict


class UnsafeQueryResponse(BaseModel):
    response: str
    session_id: str
    timestamp: str
