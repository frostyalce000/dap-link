"use client";

import { ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { saveCampaign, suggestQuestions, type CampaignFormState } from "@/app/dashboard/actions";
import { Card, Field, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { slugify } from "@/lib/slug";
import { MAX_QUESTIONS } from "@/lib/validation";

export type CampaignFormValues = {
  id: string | null;
  status: "draft" | "published" | "paused";
  productName: string;
  productDescription: string;
  productImageUrl: string | null;
  slug: string;
  questions: string[];
  rewardHeadline: string;
  rewardKind: "generated" | "static";
  rewardCodePrefix: string;
  rewardStaticCode: string;
  rewardInstructions: string;
};

const STARTER_QUESTIONS = [
  "What do you think of it?",
  "How much do you think it should cost?",
  "What would make you more likely to buy it?",
];

export const EMPTY_CAMPAIGN: CampaignFormValues = {
  id: null,
  status: "draft",
  productName: "",
  productDescription: "",
  productImageUrl: null,
  slug: "",
  questions: STARTER_QUESTIONS,
  rewardHeadline: "20% off your next order",
  rewardKind: "generated",
  rewardCodePrefix: "THANKS20",
  rewardStaticCode: "",
  rewardInstructions: "",
};

/**
 * Shrinks a photo in the browser before upload. Phone photos are often 5 MB
 * or more; the public page never needs more than about 1600px, and a smaller
 * file means a faster-loading link for every participant.
 */
async function resizeImage(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("resize failed"))), "image/jpeg", 0.86),
  );
}

export function CampaignForm({ initial, appHost }: { initial: CampaignFormValues; appHost: string }) {
  const [state, formAction, pending] = useActionState<CampaignFormState, FormData>(saveCampaign, {});
  const [values, setValues] = useState(initial);
  // The link follows the product name until the merchant edits it by hand.
  const [slugEdited, setSlugEdited] = useState(initial.id !== null);
  const [image, setImage] = useState<{ blob: Blob; preview: string } | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggesting, startSuggesting] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const errors = state.fieldErrors ?? {};
  const preview = image?.preview ?? (removeImage ? null : values.productImageUrl);
  const isPublished = initial.status === "published";

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setImageError(null);
    try {
      const blob = await resizeImage(file);
      setImage((previous) => {
        if (previous) URL.revokeObjectURL(previous.preview);
        return { blob, preview: URL.createObjectURL(blob) };
      });
      setRemoveImage(false);
    } catch {
      setImageError("That file couldn't be read as an image. Try a JPG or PNG.");
    }
  };

  const onSuggest = () => {
    setSuggestError(null);
    startSuggesting(async () => {
      const result = await suggestQuestions(values.productName, values.productDescription);
      if ("error" in result) setSuggestError(result.error);
      else if (result.questions.length > 0) set("questions", result.questions);
    });
  };

  return (
    <form
      action={(formData) => {
        // The file input holds the original photo; send the resized one instead.
        formData.delete("image");
        if (image) formData.set("image", image.blob, "product.jpg");
        formAction(formData);
      }}
      className="space-y-5"
    >
      {values.id && <input type="hidden" name="campaignId" value={values.id} />}
      <input type="hidden" name="removeImage" value={removeImage ? "1" : "0"} />

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold">1. What do you want feedback on?</h2>
        <Field label="Product or campaign name" htmlFor="productName" error={errors.productName}>
          <input
            id="productName"
            name="productName"
            required
            maxLength={80}
            value={values.productName}
            onChange={(event) => {
              const productName = event.target.value;
              setValues((current) => ({
                ...current,
                productName,
                slug: slugEdited ? current.slug : slugify(productName),
              }));
            }}
            placeholder="The Everyday Hoodie"
            className={inputClass}
          />
        </Field>

        <div>
          <p className="text-sm font-medium">Photo</p>
          <p className="mt-0.5 text-[13px] text-muted">Shown at the top of your link. Optional, but it helps a lot.</p>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-paper text-muted">
              {preview ? (
                // A local preview or an already-uploaded photo; not worth the image optimiser.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="size-full object-cover" />
              ) : (
                <ImagePlus className="size-6" aria-hidden="true" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${secondaryButtonClass} h-10`} onClick={() => fileRef.current?.click()}>
                {preview ? "Change photo" : "Add photo"}
              </button>
              {preview && (
                <button
                  type="button"
                  className="h-10 px-2 text-sm font-medium text-muted underline underline-offset-4"
                  onClick={() => {
                    setImage(null);
                    setRemoveImage(true);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-label="Product photo"
              onChange={(event) => void onPickImage(event.target.files?.[0])}
            />
          </div>
          {(imageError ?? errors.image) && (
            <p className="mt-1.5 text-[13px] text-bad" role="alert">
              {imageError ?? errors.image}
            </p>
          )}
        </div>

        <Field
          label="Anything EDNA should know?"
          htmlFor="productDescription"
          hint="Price, colours, launch date. EDNA is the AI that interviews your customers; this helps her ask better follow-ups."
          error={errors.productDescription}
        >
          <textarea
            id="productDescription"
            name="productDescription"
            rows={3}
            maxLength={600}
            value={values.productDescription}
            onChange={(event) => set("productDescription", event.target.value)}
            placeholder="Heavyweight organic cotton, relaxed fit. Launching next month in black, oat and green. Planned price $95."
            className={inputClass}
          />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">2. What do you want to ask?</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Three works best: it keeps the conversation to about a minute.
            </p>
          </div>
          <button
            type="button"
            onClick={onSuggest}
            disabled={suggesting || values.productName.trim().length < 2}
            className={`${secondaryButtonClass} h-10`}
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {suggesting ? "Writing…" : "Suggest for me"}
          </button>
        </div>
        {suggestError && (
          <p className="text-[13px] text-bad" role="alert">
            {suggestError}
          </p>
        )}

        <ol className="space-y-2">
          {values.questions.map((question, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="w-5 shrink-0 pt-3 text-center text-sm font-semibold text-muted">{index + 1}</span>
              {/* A textarea that grows with its content, so long questions stay readable on a phone. */}
              <textarea
                name="questions"
                aria-label={`Question ${index + 1}`}
                rows={1}
                maxLength={200}
                value={question}
                onChange={(event) =>
                  set(
                    "questions",
                    values.questions.map((q, i) => (i === index ? event.target.value : q)),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                placeholder="Ask an open question"
                className={`${inputClass} resize-none [field-sizing:content]`}
              />
              <button
                type="button"
                aria-label={`Remove question ${index + 1}`}
                disabled={values.questions.length <= 1}
                onClick={() => set("questions", values.questions.filter((_, i) => i !== index))}
                className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-line hover:text-ink disabled:opacity-30"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
        {errors.questions && (
          <p className="text-[13px] text-bad" role="alert">
            {errors.questions}
          </p>
        )}
        {values.questions.length < MAX_QUESTIONS && (
          <button
            type="button"
            onClick={() => set("questions", [...values.questions, ""])}
            className="inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a question
          </button>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold">3. What do people get?</h2>
        <Field
          label="Reward"
          htmlFor="rewardHeadline"
          hint="Shown on your link before people start."
          error={errors.rewardHeadline}
        >
          <input
            id="rewardHeadline"
            name="rewardHeadline"
            required
            maxLength={80}
            value={values.rewardHeadline}
            onChange={(event) => set("rewardHeadline", event.target.value)}
            placeholder="20% off your next order"
            className={inputClass}
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium">Discount code</legend>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["generated", "A unique code for each person", "We generate one per response, so codes can't be shared around."],
                ["static", "One code for everyone", "Use a code you've already set up in your store."],
              ] as const
            ).map(([kind, title, description]) => (
              <label
                key={kind}
                className={`cursor-pointer rounded-xl border p-3 transition ${
                  values.rewardKind === kind ? "border-ink bg-paper" : "border-line-strong"
                }`}
              >
                <input
                  type="radio"
                  name="rewardKind"
                  value={kind}
                  checked={values.rewardKind === kind}
                  onChange={() => set("rewardKind", kind)}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold">{title}</span>
                <span className="mt-0.5 block text-[13px] text-muted">{description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {values.rewardKind === "generated" ? (
          <Field
            label="Code prefix"
            htmlFor="rewardCodePrefix"
            hint={`Codes will look like ${(values.rewardCodePrefix || "THANKS20").toUpperCase()}-7F3K9Q.`}
            error={errors.rewardCodePrefix}
          >
            <input
              id="rewardCodePrefix"
              name="rewardCodePrefix"
              maxLength={10}
              value={values.rewardCodePrefix}
              onChange={(event) => set("rewardCodePrefix", event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className={`${inputClass} font-mono`}
            />
          </Field>
        ) : (
          <Field label="Your code" htmlFor="rewardStaticCode" error={errors.rewardStaticCode}>
            <input
              id="rewardStaticCode"
              name="rewardStaticCode"
              maxLength={40}
              value={values.rewardStaticCode}
              onChange={(event) => set("rewardStaticCode", event.target.value)}
              placeholder="WELCOME20"
              className={`${inputClass} font-mono`}
            />
          </Field>
        )}

        <Field
          label="How to use it"
          htmlFor="rewardInstructions"
          hint="Optional. Shown under the code."
          error={errors.rewardInstructions}
        >
          <input
            id="rewardInstructions"
            name="rewardInstructions"
            maxLength={200}
            value={values.rewardInstructions}
            onChange={(event) => set("rewardInstructions", event.target.value)}
            placeholder="Enter the code at checkout. Valid for 30 days."
            className={inputClass}
          />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold">4. Your link</h2>
        <Field label="Link address" htmlFor="slug" error={errors.slug}>
          <div className="flex items-center rounded-xl border border-line-strong bg-surface focus-within:border-ink">
            <span className="shrink-0 pl-3.5 text-base text-muted">{appHost}/</span>
            <input
              id="slug"
              name="slug"
              required
              maxLength={48}
              value={values.slug}
              onChange={(event) => {
                setSlugEdited(true);
                set("slug", event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
              }}
              placeholder="everyday-hoodie"
              className="w-full min-w-0 rounded-r-xl bg-transparent py-2.5 pr-3.5 text-base outline-none"
            />
          </div>
        </Field>
        {isPublished && values.slug !== initial.slug && (
          <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
            Changing the address breaks the link you&apos;ve already shared.
          </p>
        )}
      </Card>

      {state.error && (
        <p className="rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm text-bad" role="alert">
          {state.error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
        <Link
          href={values.id ? `/dashboard/campaigns/${values.id}` : "/dashboard"}
          className="mr-auto text-sm font-medium text-muted underline-offset-4 hover:underline"
        >
          Cancel
        </Link>
        {!isPublished && (
          <button type="submit" name="intent" value="draft" disabled={pending} className={secondaryButtonClass}>
            Save draft
          </button>
        )}
        <button type="submit" name="intent" value="publish" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving…" : isPublished ? "Save changes" : "Publish link"}
        </button>
      </div>
    </form>
  );
}
