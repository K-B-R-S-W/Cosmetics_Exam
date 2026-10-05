"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";

export function ThresholdControl({
  examId,
  initialValue,
  disabled = false,
}: {
  examId: string;
  initialValue: number;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [saved, setSaved] = useState(initialValue);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function save() {
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      setError("Enter a number from 1 to 100.");
      return;
    }
    setError(undefined);
    const response = await fetch(`/api/admin/exams/${examId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag_threshold: value }),
    });
    if (!response.ok) {
      setError("The flag threshold could not be saved.");
      return;
    }
    setSaved(value);
    setMessage(`Flag threshold set to ${value}.`);
  }

  return (
    <div>
      <Field
        id="live-flag-threshold"
        label="Flag at"
        type="number"
        min={1}
        max={100}
        value={value}
        error={error}
        disabled={disabled}
        onChange={(event) => {
          setValue(Number(event.target.value));
          setMessage(undefined);
        }}
        onBlur={() => {
          if (value !== saved) void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
      />
      {message ? (
        <p role="status" className="mt-2 text-sm text-ok">
          {message}
        </p>
      ) : null}
    </div>
  );
}
