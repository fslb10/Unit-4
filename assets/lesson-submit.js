(function () {
  const ENDPOINT =
    "https://okieanoysldlblqdtrau.supabase.co/functions/v1/lesson-submission";

  function getGlobal(name) {
    try {
      return Function("return typeof " + name + " !== 'undefined' ? " + name + " : undefined")();
    } catch {
      return undefined;
    }
  }

  function callGlobal(name) {
    const fn = getGlobal(name);
    if (typeof fn !== "function") return undefined;
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function words(value) {
    const s = text(value).trim();
    return s ? s.split(/\s+/).length : 0;
  }

  function getLessonMeta() {
    const path = window.location.pathname;
    const match = path.match(/\/(Unit-\d+|unit-\d+)\/apps\/(\d+)-(\d+)-[^/]+\.html$/i);
    const unitNumber = match ? match[1].match(/\d+/)[0] : "";
    const lesson = match ? unitNumber + "." + match[3] : "";
    const titleText = document.title || "";
    const title = titleText.includes(":")
      ? titleText.split(":").slice(1).join(":").trim()
      : titleText.replace(/^HRE4M1\s*(?:\u00b7|-)\s*/i, "").trim();

    return {
      unit: unitNumber ? "Unit " + unitNumber : "",
      lesson,
      lesson_title: title,
    };
  }

  function getState() {
    return getGlobal("state") || {};
  }

  function getStudentInfo(state) {
    const info = state.studentInfo || state.student || {};
    const name =
      info.name ||
      document.getElementById("studentName")?.value ||
      document.querySelector("input[autocomplete='name']")?.value ||
      "";
    const email =
      info.email ||
      document.getElementById("studentEmail")?.value ||
      document.querySelector("input[type='email']")?.value ||
      "";
    const classPeriod =
      info.classPeriod ||
      info.className ||
      info.class ||
      document.getElementById("studentClass")?.value ||
      "";

    return {
      student_name: text(name).trim(),
      student_email: text(email).trim(),
      class_period: text(classPeriod).trim(),
    };
  }

  function getResponses(state) {
    const responseState = state.responses || {};
    const order = getGlobal("RESPONSE_ORDER");
    const titles = getGlobal("RESPONSE_TITLES") || {};
    const prompts = getGlobal("PROMPTS") || {};
    const result = {};
    const keys = Array.isArray(order) && order.length ? order : Object.keys(responseState);

    keys.forEach((key) => {
      const label = titles[key] || prompts[key] || key;
      result[label] = responseState[key] ?? "";
    });

    Object.keys(responseState).forEach((key) => {
      const label = titles[key] || prompts[key] || key;
      if (!(label in result)) result[label] = responseState[key] ?? "";
    });

    return result;
  }

  function getQuizAnswers(state) {
    const quiz = getGlobal("QUIZ") || [];
    const quizState = state.quiz || {};
    const answers =
      quizState.answers && typeof quizState.answers === "object"
        ? quizState.answers
        : quizState && typeof quizState === "object"
          ? quizState
          : {};

    if (!Array.isArray(quiz) || quiz.length === 0) return answers;

    return quiz.map((q, index) => {
      const id = q.id || String(index);
      const selected =
        answers[id] !== undefined
          ? answers[id]
          : answers[index] !== undefined
            ? answers[index]
            : null;
      const options = q.opts || q.options || [];
      const correct = q.correct !== undefined ? q.correct : q.answer;

      return {
        question: q.q || q.question || "",
        selected_index: selected,
        selected_text: selected !== null && options[selected] !== undefined ? options[selected] : null,
        correct_index: correct ?? null,
        correct_text: correct !== undefined && options[correct] !== undefined ? options[correct] : null,
      };
    });
  }

  function getQuizScore(state, quizAnswers) {
    if (typeof state.quiz?.scoreCount === "number") return state.quiz.scoreCount;
    const quiz = getGlobal("QUIZ") || [];
    if (!Array.isArray(quiz) || !Array.isArray(quizAnswers)) return null;
    return quizAnswers.reduce((score, answer, index) => {
      const correct = quiz[index]?.correct !== undefined ? quiz[index].correct : quiz[index]?.answer;
      return score + (answer.selected_index !== null && answer.selected_index === correct ? 1 : 0);
    }, 0);
  }

  function getTotalWords(responses) {
    const total = callGlobal("totalWords");
    if (typeof total === "number" && Number.isFinite(total)) return total;
    return Object.values(responses).reduce((sum, value) => sum + words(value), 0);
  }

  function getTimeSpentSeconds(state) {
    const ms = callGlobal("totalTimeMs");
    if (typeof ms === "number" && Number.isFinite(ms)) return Math.max(0, Math.round(ms / 1000));
    if (typeof state.startedMs === "number") return Math.max(0, Math.round((Date.now() - state.startedMs) / 1000));
    if (state.startedAt) {
      const started = Date.parse(state.startedAt);
      const finished = state.finishedAt ? Date.parse(state.finishedAt) : Date.now();
      if (Number.isFinite(started) && Number.isFinite(finished)) {
        return Math.max(0, Math.round((finished - started) / 1000));
      }
    }
    return null;
  }

  function buildPayload(status) {
    callGlobal("persistInputsToState");
    const state = getState();
    const responses = getResponses(state);
    const quizAnswers = getQuizAnswers(state);

    return {
      ...getStudentInfo(state),
      ...getLessonMeta(),
      responses,
      quiz_answers: quizAnswers,
      quiz_score: getQuizScore(state, quizAnswers),
      total_words: getTotalWords(responses),
      time_spent_seconds: getTimeSpentSeconds(state),
      status,
    };
  }

  function setStatus(message, kind) {
    const el = document.getElementById("lessonSubmitStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind || "info";
  }

  function setBusy(busy) {
    const btn = document.getElementById("lessonSubmitButton");
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? "Submitting..." : "Submit Lesson";
  }

  async function submitLesson() {
    const payload = buildPayload("submitted");

    if (!payload.student_name || !payload.student_email) {
      setStatus("Enter your name and email before submitting.", "error");
      return;
    }

    setBusy(true);
    setStatus("Sending to teacher dashboard...", "info");

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        throw new Error(body.error || "Submission failed");
      }

      const state = getState();
      state.finishedAt = state.finishedAt || new Date().toISOString();
      state.submittedAt = new Date().toISOString();
      state.submissionId = body.id;
      callGlobal("saveLocal");
      setStatus("Submitted. Your teacher can now see this lesson.", "success");
    } catch (error) {
      setStatus("Could not submit. Please try again or use Download Report.", "error");
      console.error("Lesson submission failed:", error);
    } finally {
      setBusy(false);
    }
  }

  function addSubmitControls() {
    if (document.getElementById("lessonSubmitPanel")) return;

    const style = document.createElement("style");
    style.textContent = `
      #lessonSubmitPanel {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 9999;
        width: min(320px, calc(100vw - 36px));
        padding: 12px;
        border: 1px solid rgba(31, 41, 55, 0.18);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.2);
        color: #1f2937;
        font-family: Arial, Helvetica, sans-serif;
      }
      #lessonSubmitPanel .submit-title {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      #lessonSubmitButton {
        width: 100%;
        min-height: 42px;
        border: 0;
        border-radius: 8px;
        background: #1f2937;
        color: #fff;
        font-weight: 800;
        cursor: pointer;
      }
      #lessonSubmitButton:disabled {
        cursor: wait;
        opacity: 0.72;
      }
      #lessonSubmitStatus {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.4;
      }
      #lessonSubmitStatus[data-kind="success"] { color: #166534; }
      #lessonSubmitStatus[data-kind="error"] { color: #991b1b; }
      @media (max-width: 700px) {
        #lessonSubmitPanel {
          right: 12px;
          bottom: 12px;
          width: calc(100vw - 24px);
        }
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("aside");
    panel.id = "lessonSubmitPanel";
    panel.setAttribute("aria-label", "Lesson submission");
    panel.innerHTML =
      '<p class="submit-title">Teacher Submission</p>' +
      '<button id="lessonSubmitButton" type="button">Submit Lesson</button>' +
      '<p id="lessonSubmitStatus" data-kind="info">Saves your answers to the teacher dashboard.</p>';
    document.body.appendChild(panel);

    document.getElementById("lessonSubmitButton").addEventListener("click", submitLesson);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addSubmitControls);
  } else {
    addSubmitControls();
  }
})();
