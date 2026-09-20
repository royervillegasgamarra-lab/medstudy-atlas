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
