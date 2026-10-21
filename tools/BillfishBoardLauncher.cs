using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Billfish 中文素材板启动器")]
[assembly: AssemblyDescription("可导入 Billfish 的中文素材板启动入口")]
[assembly: AssemblyVersion("1.0.0.0")]

internal static class BillfishBoardLauncher
{
    // Resolve independently of where Billfish copies this small executable.
    private static string FindTarget()
    {
        string ownFolder = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string[] candidates = {
            Path.Combine(ownFolder, "Kanvaz-Billfish-ZhCN-9.8.2-Portable.exe"),
            Path.Combine(ownFolder, "Kanvaz-Billfish.exe"),
            @"D:\本地资源库\插件\Kanvaz-Billfish\dist\Kanvaz-Billfish-ZhCN-9.8.2-Portable.exe"
        };
        foreach (string candidate in candidates)
            if (File.Exists(candidate)) return candidate;
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Classes\KanvazBillfishZh.Board\shell\open\command"))
        {
            string command = key == null ? null : key.GetValue(null) as string;
            if (!String.IsNullOrEmpty(command) && command.StartsWith("\""))
            {
                int end = command.IndexOf('"', 1);
                if (end > 1 && File.Exists(command.Substring(1, end - 1)))
                    return command.Substring(1, end - 1);
            }
        }
        return null;
    }

    // Windows command-line escaping, including quotes and trailing backslashes.
    private static string Quote(string argument)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in argument)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { result.Append('\\', slashes * 2 + 1); result.Append(ch); }
            else { result.Append('\\', slashes); result.Append(ch); }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string target = FindTarget();
            if (target == null)
            {
                MessageBox.Show("找不到中文素材板程序。请保留 D:\\本地资源库\\插件\\Kanvaz-Billfish\\dist 中的便携版，或安装中文素材板后重试。", "素材板启动器", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }
            StringBuilder arguments = new StringBuilder();
            foreach (string argument in args)
            {
                if (arguments.Length > 0) arguments.Append(' ');
                arguments.Append(Quote(argument));
            }
            Process.Start(new ProcessStartInfo(target, arguments.ToString()) {
                UseShellExecute = false,
                WorkingDirectory = Path.GetDirectoryName(target)
            });
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show("启动失败：" + error.Message, "素材板启动器", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
