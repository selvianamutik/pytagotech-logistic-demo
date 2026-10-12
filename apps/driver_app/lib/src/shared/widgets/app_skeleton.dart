import 'package:flutter/material.dart';

/// Placeholder blok untuk state "sedang memuat".
///
/// Sengaja tanpa shimmer: shimmer butuh paket tambahan dan driver sering
/// menunggu dalam kondisi sinyal buruk, jadi blok solid yang looming
/// lebih murah dan tidak berkedip.
class AppSkeletonBlock extends StatefulWidget {
  const AppSkeletonBlock({
    super.key,
    required this.width,
    required this.height,
    this.radius = 8,
  });

  final double width;
  final double height;
  final double radius;

  @override
  State<AppSkeletonBlock> createState() => _AppSkeletonBlockState();
}

class _AppSkeletonBlockState extends State<AppSkeletonBlock>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Hormati pengaturan "kurangi animasi" di OS: tampilkan blok statis
    // alih-alih berdenyut. Tidak bisa di initState karena MediaQuery adalah
    // inherited widget.
    final disabled = MediaQuery.disableAnimationsOf(context);
    if (disabled) {
      _controller.value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            color: Color.lerp(
              scheme.surfaceContainerHighest.withValues(alpha: 0.55),
              scheme.surfaceContainerHighest.withValues(alpha: 0.95),
              _controller.value,
            ),
            borderRadius: BorderRadius.circular(widget.radius),
          ),
        );
      },
    );
  }
}
