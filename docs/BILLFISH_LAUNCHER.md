# 在 Billfish 内双击启动素材板

将 `D:\本地资源库\插件\Kanvaz-Billfish\dist\素材板启动器.exe` 拖入 Billfish 资源库，作为普通 EXE 素材导入。之后双击这个素材打开中文素材板。如果双击进入详情，请使用素材右键的打开命令或按当前 Billfish 的默认应用打开设置操作。

启动器很小，可以由 Billfish 复制到任意素材目录。它依次寻找同目录便携版、同目录主程序、本项目 `D:\本地资源库\插件\Kanvaz-Billfish\dist` 中的便携版，以及安装版登记的自身打开命令。请保留便携版文件，或先安装中文素材板。

该入口仅用于启动或激活素材板，不会自动传递 Billfish 当前选中的其他图片。需要添加图片时，在素材板内打开「Billfish 素材库」多选添加。外部程序明确传入文件路径时，启动器会原样转交给素材板。

启动器不修改 Billfish，也不自行导入文件或写素材库。导入 EXE 是用户在 Billfish 中的正常操作。删除这张 EXE 素材即移除此启动入口，不影响素材板文件。

启动器需要 Windows .NET Framework 4.x；在本机 Windows 10 上已编译并实际运行验证。它没有发布者数字签名。

重新编译（项目根目录，Windows PowerShell）：

```powershell
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" '/nologo' '/target:winexe' '/optimize+' '/reference:System.Windows.Forms.dll' '/win32icon:assets\icons\icon.ico' '/out:dist\素材板启动器.exe' 'tools\BillfishBoardLauncher.cs'
```
