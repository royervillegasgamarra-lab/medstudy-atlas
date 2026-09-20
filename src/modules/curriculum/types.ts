/**
 * Curriculum domain types for MedStudy Atlas.
 * Defines subjects and exam targets.
 */

export interface Subject {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ExamTarget {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  exam_date: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ExamTargetWithSubject extends ExamTarget {
  subject?: {
    id: string;
    name: string;
  } | null;
}

export interface CreateSubjectInput {
  name: string;
}

export interface UpdateSubjectInput {
  name: string;
}

export interface CreateExamTargetInput {
  title: string;
  exam_date: string;
  subject_id?: string | null;
}

export interface UpdateExamTargetInput {
  title?: string;
  exam_date?: string;
  subject_id?: string | null;
}
