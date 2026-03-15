import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export interface PipelineProgressEvent {
  ocrJobId: string;
  stage: string;
  current: number;
  total: number;
  message: string;
}

@Injectable()
export class PipelineProgressService {
  private readonly progressSubject = new Subject<PipelineProgressEvent>();

  getProgressStream() {
    return this.progressSubject.asObservable();
  }

  emit(event: PipelineProgressEvent) {
    this.progressSubject.next(event);
  }
}
