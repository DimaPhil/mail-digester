"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, Copy, KeyRound } from "lucide-react";
import {
  API_KEY_SCOPES,
  DEFAULT_KEY_SCOPES,
  type ApiKeyScope,
} from "@/lib/api/key-scopes";
import type { ApiKeyInfo } from "@/lib/api/keys";

const date = (value: number | null) =>
  value == null ? "Never" : new Date(value).toLocaleString();
export function AdminKeys({ initialKeys }: { initialKeys: ApiKeyInfo[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(DEFAULT_KEY_SCOPES);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const pending = useRef(false);
  async function mutate(path: string, body: unknown = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setSecret("");
    setCopied(false);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not update keys.");
      if (result.key) setSecret(result.key);
      const list = await fetch("/api/admin/keys", { cache: "no-store" });
      if (!list.ok)
        throw new Error(
          "Action succeeded, but key list could not refresh. Reload the page.",
        );
      setKeys((await list.json()).keys);
      if (path === "/api/admin/keys") setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update keys.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="admin-content">
      <Link className="admin-back" href="/">
        <ArrowLeft size={16} /> Back to library
      </Link>
      <div className="page-intro">
        <div>
          <div className="eyebrow">ADMIN SETTINGS</div>
          <h1>API keys</h1>
          <p>Credentials for the CLI and API clients.</p>
        </div>
        <KeyRound size={28} />
      </div>
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate("/api/admin/keys", { name, scopes });
        }}
      >
        <label>
          Key name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Reading agent"
          />
        </label>
        <fieldset>
          <legend>Permissions</legend>
          {API_KEY_SCOPES.map((scope) => (
            <label className="key-scope" key={scope}>
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked
                      ? [...scopes, scope]
                      : scopes.filter((s) => s !== scope),
                  )
                }
              />
              {scope}
            </label>
          ))}
        </fieldset>
        <button
          className="key-primary"
          disabled={busy || !scopes.length || !name.trim()}
        >
          Create key
        </button>
      </form>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {secret && (
        <section className="key-secret" aria-label="New API key">
          <label>
            Copy this key now. It will not be shown again.
            <input aria-label="API key secret" readOnly value={secret} />
          </label>
          <div className="key-actions">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(secret)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      "Could not copy. Select the key and copy it manually.",
                    ),
                  );
              }}
            >
              <Copy size={15} />
              {copied ? "Copied" : "Copy key"}
            </button>
            <button type="button" onClick={() => setSecret("")}>
              Done
            </button>
          </div>
        </section>
      )}
      <p className="key-note">
        The browser uses trusted Tailscale access. Keys limit API automation;
        add admin only when a client should manage keys. Rotation immediately
        revokes the old key.
      </p>
      <div className="key-list" aria-live="polite">
        {keys.length ? (
          keys.map((key) => (
            <section
              className={`key-entry ${key.revokedAt ? "key-revoked" : ""}`}
              key={key.id}
              aria-label={`Key ${key.name}`}
            >
              <div className="key-heading">
                <h2>{key.name}</h2>
                <span>
                  {key.revokedAt ? "Revoked" : "Active"} · #{key.id}
                </span>
              </div>
              <div className="key-meta">
                <code>{key.prefix}…</code>
                <span>{key.scopes.join(", ")}</span>
              </div>
              <dl>
                <div>
                  <dt>Created</dt>
                  <dd>{date(key.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>{date(key.lastUsedAt)}</dd>
                </div>
                {key.revokedAt && (
                  <div>
                    <dt>Revoked</dt>
                    <dd>{date(key.revokedAt)}</dd>
                  </div>
                )}
                {key.rotatedFrom && (
                  <div>
                    <dt>Replaces</dt>
                    <dd>Key #{key.rotatedFrom}</dd>
                  </div>
                )}
              </dl>
              {!key.revokedAt && (
                <div className="key-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(`/api/admin/keys/${key.id}/rotate`)
                    }
                  >
                    Rotate
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(`/api/admin/keys/${key.id}/revoke`)
                    }
                  >
                    Revoke
                  </button>
                </div>
              )}
            </section>
          ))
        ) : (
          <p>No API keys yet. Create one to connect the CLI.</p>
        )}
      </div>
    </main>
  );
}
