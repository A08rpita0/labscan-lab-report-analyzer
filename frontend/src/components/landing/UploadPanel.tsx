import { useRef, useState, type DragEvent } from "react";

import { ACCEPTED_EXTENSIONS, ApiError, validateFile, type Demographics } from "../../api/client";
import { bytes } from "../../lib/format";
import { Icon } from "../ui";

export function UploadPanel({ maxMb, busy, onAnalyse }: {
  maxMb: number;
  busy: boolean;
  onAnalyse: (file: File, demo: Demographics) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<ApiError | null>(null);
  const [sex, setSex] = useState<Demographics["sex"]>("");
  const [age, setAge] = useState("");

  const choose = (f: File | undefined | null) => {
    if (!f) return;
    const err = validateFile(f, maxMb);
    setProblem(err);
    setFile(err ? null : f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    if (e.dataTransfer.files.length > 1) {
      setProblem(new ApiError("multiple_files", "Drop one report at a time.", { hint: "Each analysis reads a single file." }));
      return;
    }
    choose(e.dataTransfer.files[0]);
  };

  const ext = file ? file.name.slice(file.name.lastIndexOf(".") + 1).toUpperCase() : "";
  const ageInvalid = age !== "" && (!/^\d{1,3}(\.\d+)?$/.test(age) || Number(age) > 130);

  return (
    <div className="upload panel">
      <div className="upload-head">
        <h2 className="upload-title">Upload your report</h2>
        <p className="muted small">Your file is checked and then discarded. It is never stored.</p>
      </div>

      {!file ? (
        <button
          type="button"
          className={`dropzone${over ? " is-over" : ""}`}
          onClick={() => input.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          disabled={busy}
          aria-describedby="dz-formats"
        >
          <span className="dz-icon">
            <Icon name="upload" />
          </span>
          <span className="dz-main">
            Drop your lab report here, or <u>choose a file</u>
          </span>
          <span className="dz-formats" id="dz-formats">
            {ACCEPTED_EXTENSIONS.map((x) => (
              <span key={x} className="badge badge-outline badge-mono">
                {x.slice(1).toUpperCase()}
              </span>
            ))}
            <span className="xs muted">up to {maxMb} MB</span>
          </span>
        </button>
      ) : (
        <div className="file-chip" aria-live="polite">
          <span className="file-type mono">{ext}</span>
          <span className="file-meta">
            <span className="file-name" title={file.name}>
              {file.name}
            </span>
            <span className="xs muted">
              {bytes(file.size)}, ready to check
            </span>
          </span>
          <span className="file-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => input.current?.click()} disabled={busy}>
              Replace
            </button>
            <button type="button" className="btn btn-sm btn-ghost" aria-label="Remove file" onClick={() => setFile(null)} disabled={busy}>
              <Icon name="x" />
            </button>
          </span>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {problem && (
        <div className="callout callout-warn upload-problem" role="alert">
          <Icon name="alert" />
          <div>
            <b>{problem.message}</b> {problem.hint}
          </div>
        </div>
      )}

      <div className="upload-options">
        <div className="field">
          <label htmlFor="sex">
            Sex <span className="muted xs">optional</span>
          </label>
          <select id="sex" className="select" value={sex} onChange={(e) => setSex(e.target.value as Demographics["sex"])} disabled={busy}>
            <option value="">Read from report</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="age">
            Age <span className="muted xs">optional</span>
          </label>
          <input
            id="age"
            className="input"
            inputMode="decimal"
            placeholder="Read from report"
            value={age}
            aria-invalid={ageInvalid || undefined}
            aria-describedby="age-help"
            onChange={(e) => setAge(e.target.value.trim())}
            disabled={busy}
          />
        </div>
        <p className="xs muted upload-help" id="age-help">
          Optional. Some normal ranges are different for men and women. If you leave these blank, we use what the report says.
          {ageInvalid && <span className="field-error"> Age must be a number of years, 0–130.</span>}
        </p>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-lg upload-go"
        disabled={!file || busy || ageInvalid}
        onClick={() => file && onAnalyse(file, { sex, age })}
      >
        {busy && <span className="spinner" />}
        {busy ? "Checking…" : "Check my report"}
      </button>
    </div>
  );
}
