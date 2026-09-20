export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      document_pages: {
        Row: {
          char_count: number;
          classification: string;
          created_at: string;
          document_id: string;
          extraction_method: string;
          height_points: number;
          id: string;
          native_char_count: number;
          ocr_char_count: number;
          ocr_confidence: number | null;
          page_number: number;
          processing_run_id: string;
          rotation_degrees: number;
          text_content: string;
          text_sha256: string;
          user_id: string;
          width_points: number;
        };
        Insert: {
          char_count?: number;
          classification: string;
          created_at?: string;
          document_id: string;
          extraction_method: string;
          height_points: number;
          id?: string;
          native_char_count?: number;
          ocr_char_count?: number;
          ocr_confidence?: number | null;
          page_number: number;
          processing_run_id: string;
          rotation_degrees?: number;
          text_content?: string;
          text_sha256: string;
          user_id: string;
          width_points: number;
        };
        Update: {
          char_count?: number;
          classification?: string;
          created_at?: string;
          document_id?: string;
          extraction_method?: string;
          height_points?: number;
          id?: string;
          native_char_count?: number;
          ocr_char_count?: number;
          ocr_confidence?: number | null;
          page_number?: number;
          processing_run_id?: string;
          rotation_degrees?: number;
          text_content?: string;
          text_sha256?: string;
          user_id?: string;
          width_points?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_pages_processing_run_id_fkey";
            columns: ["processing_run_id"];
            isOneToOne: false;
            referencedRelation: "document_processing_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_document_pages_doc_owner";
            columns: ["document_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      document_processing_runs: {
        Row: {
          attempt_count: number;
          created_at: string;
          document_id: string;
          error_code: string | null;
          finished_at: string | null;
          id: string;
          native_text_page_count: number;
          no_text_page_count: number;
          ocr_page_count: number;
          page_count: number | null;
          pipeline_version: string;
          source_sha256: string | null;
          started_at: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempt_count?: number;
          created_at?: string;
          document_id: string;
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          native_text_page_count?: number;
          no_text_page_count?: number;
          ocr_page_count?: number;
          page_count?: number | null;
          pipeline_version?: string;
          source_sha256?: string | null;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempt_count?: number;
          created_at?: string;
          document_id?: string;
          error_code?: string | null;
          finished_at?: string | null;
          id?: string;
          native_text_page_count?: number;
          no_text_page_count?: number;
          ocr_page_count?: number;
          page_count?: number | null;
          pipeline_version?: string;
          source_sha256?: string | null;
          started_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_processing_runs_document_owner";
            columns: ["document_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      documents: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          mime_type: string;
          original_filename: string;
          sha256_hash: string | null;
          size_bytes: number;
          status: string;
          storage_bucket: string;
          storage_key: string;
          storage_provider: string;
          subject_id: string | null;
          updated_at: string;
          user_id: string;
          validation_error_code: string | null;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          mime_type?: string;
          original_filename: string;
          sha256_hash?: string | null;
          size_bytes: number;
          status?: string;
          storage_bucket?: string;
          storage_key: string;
          storage_provider?: string;
          subject_id?: string | null;
          updated_at?: string;
          user_id: string;
          validation_error_code?: string | null;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          mime_type?: string;
          original_filename?: string;
          sha256_hash?: string | null;
          size_bytes?: number;
          status?: string;
          storage_bucket?: string;
          storage_key?: string;
          storage_provider?: string;
          subject_id?: string | null;
          updated_at?: string;
          user_id?: string;
          validation_error_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fk_documents_subject_owner";
            columns: ["subject_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      exam_targets: {
        Row: {
          archived_at: string | null;
          created_at: string;
          exam_date: string;
          id: string;
          subject_id: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          exam_date: string;
          id?: string;
          subject_id?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          exam_date?: string;
          id?: string;
          subject_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_exam_targets_subject_owner";
            columns: ["subject_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "subjects";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      subjects: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          medical_school: string | null;
          onboarding_completed_at: string | null;
          updated_at: string;
          year_of_study: number | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          medical_school?: string | null;
          onboarding_completed_at?: string | null;
          updated_at?: string;
          year_of_study?: number | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          medical_school?: string | null;
          onboarding_completed_at?: string | null;
          updated_at?: string;
          year_of_study?: number | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      archive_document_privileged: {
        Args: { p_document_id: string; p_user_id: string };
        Returns: boolean;
      };
      claim_next_processing_run: {
        Args: { p_lease_seconds?: number; p_worker_id: string };
        Returns: {
          attempt_count: number;
          document_id: string;
          original_filename: string;
          pipeline_version: string;
          run_id: string;
          size_bytes: number;
          storage_bucket: string;
          storage_key: string;
          user_id: string;
        }[];
      };
      complete_document_cleanup_privileged: {
        Args: {
          p_document_id: string;
          p_error_code: string;
          p_status: string;
          p_user_id: string;
        };
        Returns: {
          archived_at: string | null;
          created_at: string;
          id: string;
          mime_type: string;
          original_filename: string;
          sha256_hash: string | null;
          size_bytes: number;
          status: string;
          storage_bucket: string;
          storage_key: string;
          storage_provider: string;
          subject_id: string | null;
          updated_at: string;
          user_id: string;
          validation_error_code: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "documents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      complete_onboarding: { Args: never; Returns: string };
      enqueue_document_processing_privileged: {
        Args: {
          p_document_id: string;
          p_pipeline_version?: string;
          p_user_id: string;
        };
        Returns: {
          attempt_count: number;
          document_id: string;
          pipeline_version: string;
          run_id: string;
          status: string;
          user_id: string;
        }[];
      };
      fail_processing_run_privileged: {
        Args: { p_error_code: string; p_retryable?: boolean; p_run_id: string };
        Returns: boolean;
      };
      finalize_document_upload_privileged: {
        Args: {
          p_actual_size: number;
          p_document_id: string;
          p_sha256?: string;
          p_user_id: string;
        };
        Returns: {
          archived_at: string | null;
          created_at: string;
          id: string;
          mime_type: string;
          original_filename: string;
          sha256_hash: string | null;
          size_bytes: number;
          status: string;
          storage_bucket: string;
          storage_key: string;
          storage_provider: string;
          subject_id: string | null;
          updated_at: string;
          user_id: string;
          validation_error_code: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "documents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      persist_processing_run_results_privileged: {
        Args: { p_manifest: Json; p_pages: Json; p_run_id: string };
        Returns: boolean;
      };
      request_document_upload: {
        Args: {
          p_mime_type?: string;
          p_original_filename: string;
          p_size_bytes: number;
          p_subject_id?: string;
        };
        Returns: {
          document_id: string;
          storage_bucket: string;
          storage_key: string;
        }[];
      };
      start_document_cleanup_privileged: {
        Args: { p_document_id: string; p_user_id: string };
        Returns: {
          archived_at: string | null;
          created_at: string;
          id: string;
          mime_type: string;
          original_filename: string;
          sha256_hash: string | null;
          size_bytes: number;
          status: string;
          storage_bucket: string;
          storage_key: string;
          storage_provider: string;
          subject_id: string | null;
          updated_at: string;
          user_id: string;
          validation_error_code: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "documents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
