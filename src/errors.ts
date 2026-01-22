export enum ExitCode {
  Success = 0,
  UsageError = 2,
  ConfigError = 3,
  AuthError = 4,
  FilesystemError = 5,
  DependencyError = 6,
  NetworkError = 7,
  InternalError = 8,
}

export class EikonError extends Error {
  constructor(
    public override message: string,
    public exitCode: ExitCode = ExitCode.InternalError,
    public hints: string[] = [],
    public type: string = "internal"
  ) {
    super(message);
    this.name = "EikonError";
  }

  toJSON() {
    return {
      ok: false,
      error: {
        type: this.type,
        code: this.exitCode,
        message: this.message,
        hints: this.hints,
      },
    };
  }
}

export class UsageError extends EikonError {
  constructor(message: string, hints: string[] = []) {
    super(message, ExitCode.UsageError, hints, "usage");
  }
}

export class ConfigError extends EikonError {
  constructor(message: string, hints: string[] = []) {
    super(message, ExitCode.ConfigError, hints, "config");
  }
}

export class AuthError extends EikonError {
  constructor(message: string, hints: string[] = []) {
    super(message, ExitCode.AuthError, hints, "auth");
  }
}

export class FilesystemError extends EikonError {
  constructor(message: string, hints: string[] = []) {
    super(message, ExitCode.FilesystemError, hints, "filesystem");
  }
}

export class DependencyError extends EikonError {
  constructor(message: string, hints: string[] = []) {
    super(message, ExitCode.DependencyError, hints, "dependency");
  }
}

export class NetworkError extends EikonError {
  constructor(message: string, hints: string[] = []) {
    super(message, ExitCode.NetworkError, hints, "network");
  }
}
