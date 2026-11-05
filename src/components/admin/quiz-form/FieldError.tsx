interface FieldErrorProps {
    error?: { message?: string };
}

/** Red message under a field; renders nothing while the field is valid. */
export default function FieldError({ error }: FieldErrorProps) {
    return error ? <p className="mt-1 text-sm text-red-400">{error.message}</p> : null;
}
