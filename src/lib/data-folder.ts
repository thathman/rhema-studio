import { invoke } from "@tauri-apps/api/core"

/** Where this computer keeps services and songs (#298 S7.1): the data folder and its database file. */
export interface DataPaths {
  folder: string
  database: string
}

export const dataPaths = () => invoke<DataPaths>("setup_data_paths")

/** Show the database file in Finder / Explorer. */
export const showDataFolder = () => invoke<void>("setup_show_data_folder")

/** Write a small file in the folder and delete it again (#298 S7.5): resolves when the folder can be written to. */
export const testFolderWritable = (path: string) => invoke<void>("setup_test_folder", { path })
