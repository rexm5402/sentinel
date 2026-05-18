import uuid
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from models.schemas import (
    QueryRequest,
    QueryResponse,
    ProbeRequest,
    TrilemmaScores,
    ReportRequest,
    ComplianceReport,
    SessionLog,
    UnsafeQueryResponse,
)
from agents.groq_agent import query_llm, query_llm_raw, query_llm_pro
from agents.claude_judge import evaluate_response
from agents.unlearning_probe import run_unlearning_probe

load_dotenv()

# ---------------------------------------------------------------------------
# In-memory session log store
# ---------------------------------------------------------------------------
session_logs: list[SessionLog] = []


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield  # startup / shutdown hooks can go here


app = FastAPI(
    title="SENTINEL",
    description="Enterprise AI Safety Platform — clinical AI monitoring and compliance",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/query", response_model=QueryResponse, summary="Send a message to Gemini Flash and evaluate with Gemini Pro")
async def query_endpoint(body: QueryRequest):
    """
    1. Sends the user message to Gemini Flash (clinical DSS persona).
    2. Intercepts the response and sends both message + response to Gemini Pro for safety evaluation.
    3. Logs the interaction and returns the combined result.
    """
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    try:
        gemini_response = await query_llm(body.message)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Groq LLM error: {e}")

    try:
        safety = await evaluate_response(body.message, gemini_response)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Groq safety evaluation error: {e}")

    session_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()

    log = SessionLog(
        session_id=session_id,
        timestamp=timestamp,
        user_message=body.message,
        gemini_response=gemini_response,
        safety=safety,
    )
    session_logs.append(log)

    return QueryResponse(
        gemini_response=gemini_response,
        safety=safety,
        session_id=session_id,
        timestamp=timestamp,
    )


@app.post("/probe", response_model=TrilemmaScores, summary="Run the machine unlearning trilemma probe")
async def probe_endpoint(body: ProbeRequest):
    """
    Fires 5 probe queries at Gemini Pro to evaluate the unlearning trilemma:
    - Forgetting score  (sensitive content no longer reproduced)
    - Utility score     (benign clinical queries still answered correctly)
    - Detectability score (refusals are targeted, not blanket)
    Returns trilemma_violation=True if any dimension falls below threshold.
    """
    try:
        scores = await run_unlearning_probe(topic=body.topic or "medication dosage")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Probe execution error: {e}")

    return scores


@app.post("/report", response_model=ComplianceReport, summary="Generate a compliance report from session logs")
async def report_endpoint(body: ReportRequest):
    """
    Uses Gemini Pro to synthesize session logs into a structured compliance report.
    Pass session_ids to filter; omit (or pass null) for all sessions.
    """
    if not session_logs:
        raise HTTPException(status_code=404, detail="No session logs available to report on")

    logs_to_report = (
        [log for log in session_logs if log.session_id in body.session_ids]
        if body.session_ids
        else session_logs
    )

    if not logs_to_report:
        raise HTTPException(status_code=404, detail="No logs matched the provided session IDs")

    # Aggregate stats
    total = len(logs_to_report)
    flagged = sum(1 for l in logs_to_report if l.safety.verdict == "FLAGGED")
    warnings = sum(1 for l in logs_to_report if l.safety.verdict == "WARNING")
    safe = sum(1 for l in logs_to_report if l.safety.verdict == "SAFE")
    hipaa = sum(1 for l in logs_to_report if l.safety.hipaa_risk)

    log_summary = "\n\n".join(
        f"Session {i + 1} [{log.session_id}] — {log.timestamp}\n"
        f"  Verdict: {log.safety.verdict} (confidence {log.safety.confidence:.2f})\n"
        f"  HIPAA Risk: {log.safety.hipaa_risk}\n"
        f"  Flags: {', '.join(log.safety.flags) or 'none'}\n"
        f"  User query: {log.user_message[:120]}\n"
        f"  Explanation: {log.safety.explanation[:200]}"
        for i, log in enumerate(logs_to_report)
    )

    report_prompt = f"""You are a healthcare AI compliance officer writing an internal audit report.

The following session logs are from SENTINEL, an AI safety monitoring platform watching a clinical decision support assistant used by nurses.

SESSION LOGS:
{log_summary}

AGGREGATE STATS:
- Total queries reviewed: {total}
- FLAGGED: {flagged}
- WARNING: {warnings}
- SAFE: {safe}
- HIPAA risk incidents: {hipaa}

Write a professional compliance report that:
1. Summarises the overall safety posture
2. Calls out the most serious incidents (FLAGGED sessions) with specific detail
3. Identifies recurring patterns or systemic risks
4. Provides 3–5 concrete remediation recommendations
5. Concludes with a compliance status: COMPLIANT / NEEDS REVIEW / NON-COMPLIANT

Use formal language appropriate for a healthcare compliance audit. Plain text only — no markdown."""

    try:
        report_text = await query_llm_pro(report_prompt)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Groq report generation error: {e}")

    return ComplianceReport(
        report=report_text.strip(),
        total_queries=total,
        flagged_count=flagged,
        warning_count=warnings,
        safe_count=safe,
        hipaa_violations=hipaa,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@app.get("/logs", response_model=list[SessionLog], summary="Return all session logs")
async def logs_endpoint():
    """Returns all in-memory session logs, newest first."""
    return list(reversed(session_logs))


@app.post("/query-unsafe", response_model=UnsafeQueryResponse, summary="Raw LLM completion with no system prompt or safety guardrails (demo: BEFORE)")
async def query_unsafe_endpoint(body: QueryRequest):
    """
    Sends the user message directly to the LLM with no system prompt —
    no persona, no guardrails, no safety instructions of any kind.
    Response is returned as-is with no safety evaluation or audit logging.
    Used in the demo to show the BEFORE state (fully unguarded model output).
    """
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    try:
        response = await query_llm_raw(body.message)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Groq LLM error: {e}")

    return UnsafeQueryResponse(
        response=response,
        session_id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
